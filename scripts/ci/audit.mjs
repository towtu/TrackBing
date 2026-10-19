import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {'info' | 'low' | 'moderate' | 'high' | 'critical'} Severity */
/** @typedef {{info: number, low: number, moderate: number, high: number, critical: number, total: number}} Totals */
/** @typedef {{package: string, advisory: string, severity: Severity}} Advisory */
/** @typedef {{package: string, advisory: string, severity: 'high', owner: string, reason: string, expires: string}} Exception */
/** @typedef {Advisory & {decision: 'exception' | 'block' | 'report', exception?: Exception}} AdvisoryDecision */
/** @typedef {{schemaVersion: number, checkedAt: string, status: 'passed' | 'failed' | 'error', totals: Totals | null, advisories: AdvisoryDecision[], acknowledgedHighAdvisories: number, problems: string[]}} AuditResult */

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const packagePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const advisoryPattern = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

class AuditPolicyError extends Error {}

function fail(message) {
  throw new AuditPolicyError(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPackage(value) {
  return typeof value === 'string' && value.length <= 214 && packagePattern.test(value);
}

function key(packageName, advisory) {
  return `${packageName}:${advisory}`;
}

function validateExceptions(policy, now) {
  if (!isRecord(policy) || policy.version !== 1 || !Array.isArray(policy.exceptions) ||
      Object.keys(policy).some((field) => !['version', 'exceptions'].includes(field))) {
    fail('Invalid audit exception policy. Expected version 1 and an exceptions array.');
  }
  const exceptions = new Map();
  const fields = ['package', 'advisory', 'severity', 'owner', 'reason', 'expires'];
  for (const entry of policy.exceptions) {
    if (!isRecord(entry) || Object.keys(entry).length !== fields.length ||
        Object.keys(entry).some((field) => !fields.includes(field)) ||
        !isPackage(entry.package) || typeof entry.advisory !== 'string' || !advisoryPattern.test(entry.advisory) ||
        entry.severity !== 'high' || entry.owner !== 'towtu' ||
        typeof entry.reason !== 'string' || entry.reason.trim().length < 20 ||
        entry.reason.length > 2000 || /[\x00-\x1f\x7f]/.test(entry.reason) ||
        typeof entry.expires !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      fail('Invalid audit exception. Each exception needs an exact package/advisory, high severity, owner towtu, rationale and UTC expiry date. Critical exceptions are forbidden.');
    }
    const expiry = new Date(`${entry.expires}T00:00:00.000Z`);
    if (!Number.isFinite(expiry.getTime()) || expiry.toISOString().slice(0, 10) !== entry.expires) {
      fail('Invalid audit exception expiry date.');
    }
    // The exception stops applying at 00:00 UTC on its expiry date.
    if (now.getTime() >= expiry.getTime()) {
      fail(`Audit exception expired: ${entry.package} ${entry.advisory} on ${entry.expires} UTC.`);
    }
    const entryKey = key(entry.package, entry.advisory);
    if (exceptions.has(entryKey)) fail('Duplicate audit exception.');
    exceptions.set(entryKey, entry);
  }
  return exceptions;
}

function parseAudit(execution) {
  if (!isRecord(execution) || execution.error != null || execution.signal != null ||
      ![0, 1].includes(execution.status) || typeof execution.stdout !== 'string') {
    fail('npm audit could not complete successfully. Check registry access and npm availability.');
  }
  let report;
  try {
    report = JSON.parse(execution.stdout);
  } catch {
    fail('npm audit did not return valid JSON.');
  }
  if (!isRecord(report) || Object.hasOwn(report, 'error')) {
    fail('npm audit returned a registry or command error. Response bodies are omitted.');
  }
  if (report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities) ||
      !isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities)) {
    fail('Unsupported or malformed npm audit report.');
  }

  const counts = report.metadata.vulnerabilities;
  const expected = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const graph = new Map();
  const advisories = new Map();
  for (const [packageName, entry] of Object.entries(report.vulnerabilities)) {
    if (!isPackage(packageName) || !isRecord(entry) || entry.name !== packageName ||
        !severities.includes(entry.severity) || !Array.isArray(entry.via) || !entry.via.length) {
      fail('Malformed npm audit vulnerability record.');
    }
    expected[entry.severity]++;
    expected.total++;
    const dependencies = [];
    const roots = new Set();
    for (const via of entry.via) {
      if (typeof via === 'string') {
        if (!isPackage(via)) fail('Malformed inherited audit dependency.');
        dependencies.push(via);
        continue;
      }
      if (!isRecord(via) || via.name !== packageName || via.dependency !== packageName ||
          !severities.includes(via.severity) || typeof via.url !== 'string') {
        fail('Malformed underlying npm advisory.');
      }
      const match = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/.exec(via.url);
      if (!match) fail('Unrecognized underlying advisory identifier; review the npm audit format.');
      const advisoryKey = key(packageName, match[1]);
      if (advisories.has(advisoryKey) && advisories.get(advisoryKey).severity !== via.severity) {
        fail('Conflicting severity for an underlying advisory.');
      }
      advisories.set(advisoryKey, { package: packageName, advisory: match[1], severity: via.severity });
      roots.add(advisoryKey);
    }
    graph.set(packageName, { severity: entry.severity, dependencies, roots });
  }

  for (const field of [...severities, 'total']) {
    if (!Number.isSafeInteger(counts[field]) || counts[field] < 0 || counts[field] !== expected[field]) {
      fail('npm audit severity totals do not match its vulnerability records.');
    }
  }
  if (execution.status !== (expected.total - expected.info > 0 ? 1 : 0)) {
    fail('npm audit exit status is inconsistent with its vulnerability totals.');
  }

  // npm reports real inherited cycles (for example metro <-> metro-config).
  // Propagate all reachable direct advisories until stable; a rootless cycle
  // stays empty and is rejected below instead of being silently acknowledged.
  for (const entry of graph.values()) {
    if (entry.dependencies.some((dependency) => !graph.has(dependency))) {
      fail('Inherited npm audit dependency is missing from the report.');
    }
  }
  let changed;
  do {
    changed = false;
    for (const entry of graph.values()) {
      for (const dependency of entry.dependencies) {
        for (const root of graph.get(dependency).roots) {
          if (!entry.roots.has(root)) {
            entry.roots.add(root);
            changed = true;
          }
        }
      }
    }
  } while (changed);
  for (const entry of graph.values()) {
    if (!entry.roots.size) fail('Inherited npm audit graph has a vulnerability with no underlying advisory (including a rootless cycle).');
    const highestRootSeverity = Math.max(...Array.from(entry.roots, (root) => severities.indexOf(advisories.get(root).severity)));
    if (highestRootSeverity !== severities.indexOf(entry.severity)) {
      fail('Inherited npm audit severity cannot be explained by its underlying advisories.');
    }
  }
  return { totals: expected, advisories: Array.from(advisories.values()) };
}

/**
 * Evaluate captured npm output without printing registry bodies or error details.
 * @param {unknown} execution
 * @param {unknown} policy
 * @param {Date} now
 * @returns {AuditResult}
 */
export function evaluateAudit(execution, policy, now = new Date()) {
  /** @type {AuditResult} */
  const result = {
    schemaVersion: 1,
    checkedAt: now.toISOString(),
    status: 'error',
    totals: null,
    advisories: [],
    acknowledgedHighAdvisories: 0,
    problems: [],
  };
  try {
    const parsed = parseAudit(execution);
    result.totals = parsed.totals;
    // Keep validated findings visible even if exception policy validation fails.
    // Until the entire policy is accepted, every high/critical finding blocks.
    result.advisories = parsed.advisories
      .sort((first, second) => key(first.package, first.advisory).localeCompare(key(second.package, second.advisory)))
      .map((advisory) => ({ ...advisory, decision: ['high', 'critical'].includes(advisory.severity) ? 'block' : 'report' }));
    const exceptions = validateExceptions(policy, now);
    result.advisories = result.advisories
      .map((advisory) => {
        if (advisory.severity === 'critical') return { ...advisory, decision: 'block' };
        if (advisory.severity !== 'high') return { ...advisory, decision: 'report' };
        const exception = exceptions.get(key(advisory.package, advisory.advisory));
        if (!exception) return { ...advisory, decision: 'block' };
        result.acknowledgedHighAdvisories++;
        return { ...advisory, decision: 'exception', exception };
      });
    const blocked = result.advisories.filter((advisory) => advisory.decision === 'block');
    result.status = blocked.length ? 'failed' : 'passed';
    if (blocked.length) result.problems.push(`${blocked.length} high/critical underlying advisories are blocked by the audit policy.`);
  } catch (error) {
    result.problems.push(error instanceof AuditPolicyError ? error.message : 'Unexpected audit processing failure. Details are omitted.');
  }
  return result;
}

function main() {
  const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
  const artifactPath = join(projectRoot, 'output/ci/audit.json');
  let policy;
  try {
    policy = JSON.parse(readFileSync(join(projectRoot, '.github/security-audit-exceptions.json'), 'utf8'));
  } catch {
    // The policy validator rejects an unreadable or invalid policy, even for a clean audit.
    policy = null;
  }
  const execution = spawnSync('npm', ['audit', '--json', '--audit-level=low', '--include=dev', '--include=optional', '--include=peer'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 20 * 1024 * 1024,
    shell: false,
  });
  const result = evaluateAudit(execution, policy);
  try {
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch {
    console.error('Audit failed: could not write output/ci/audit.json.');
    process.exitCode = 1;
    return;
  }
  if (result.totals) {
    console.log(`npm audit: ${result.totals.critical} critical, ${result.totals.high} high, ${result.totals.moderate} moderate, ${result.totals.low} low, ${result.totals.info} info (${result.totals.total} affected packages, including inherited findings).`);
  }
  for (const advisory of result.advisories) {
    const expiry = advisory.exception ? `; owner ${advisory.exception.owner}, expires ${advisory.exception.expires} 00:00 UTC` : '';
    console.log(`${advisory.decision}: ${advisory.severity} ${advisory.package} ${advisory.advisory}${expiry}`);
  }
  for (const problem of result.problems) console.error(problem);
  if (result.status === 'passed' && result.acknowledgedHighAdvisories) {
    console.log(`Audit policy passed with ${result.acknowledgedHighAdvisories} temporary high advisory acknowledgements; these findings remain open.`);
  } else {
    console.log(`Audit policy ${result.status}.`);
  }
  console.log('Audit artifact: output/ci/audit.json');
  process.exitCode = result.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
