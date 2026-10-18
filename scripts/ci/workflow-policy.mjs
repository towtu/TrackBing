import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { parseDocument } from 'yaml';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const pinnedAction = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f\d]{40}$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const needs = job => typeof job?.needs === 'string' ? [job.needs] : Array.isArray(job?.needs) ? job.needs : [];

function parse(source, file, problems) {
  try {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length || document.warnings.length) throw new Error('Invalid YAML');
    const data = document.toJS({ maxAliasCount: 0 });
    if (!object(data)) throw new Error('Invalid mapping');
    return data;
  } catch {
    // Parser errors can include source lines containing credentials.
    problems.push(`${file}: valid YAML with unique mapping keys is required`);
    return null;
  }
}

function visit(value, path, check) {
  if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`, check));
  else if (object(value)) {
    check(value, path);
    for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`, check);
  }
}

function usesSecrets(value) {
  if (typeof value === 'string') return /\$\{\{[^}]*\bsecrets\b/.test(value);
  if (Array.isArray(value)) return value.some(usesSecrets);
  return object(value) && (Object.hasOwn(value, 'secrets') || Object.values(value).some(usesSecrets));
}

function readOnly(permissions, requireContents = false) {
  return object(permissions)
    && (!requireContents || permissions.contents === 'read')
    && Object.entries(permissions).every(([name, access]) => ['contents', 'actions'].includes(name) && access === 'read');
}

function safeArtifactPath(path) {
  if (typeof path !== 'string') return false;
  const paths = path.trim().split(/\r?\n/).map(line => line.trim());
  return paths.length > 0 && paths.every(line => {
    const scoped = line.replace(/^!/, '').replace(/^\.\//, '');
    return /^(?:output|dist)(?:\/|$)/.test(scoped)
      && !scoped.includes('\\')
      && !scoped.split('/').includes('..')
      && !/(?:^|\/)\.env(?:[./]|$)|\.(?:pem|key|p12|pfx)(?:$|[\s*?])/i.test(scoped);
  });
}

function checkShared(data, file, problems) {
  visit(data, file, (node, path) => {
    if (Object.hasOwn(node, 'continue-on-error')) problems.push(`${path}: remove continue-on-error; required failures must block`);
    if (node.secrets === 'inherit') problems.push(`${path}: secrets: inherit is forbidden; keep verification isolated`);
    if (Object.hasOwn(node, 'permissions') && !readOnly(node.permissions)) problems.push(`${path}.permissions: use explicit read-only contents/actions permissions`);
    if (!Object.hasOwn(node, 'uses')) return;
    if (typeof node.uses !== 'string' || (!node.uses.startsWith('./') && !pinnedAction.test(node.uses))) {
      problems.push(`${path}.uses: pin external actions and workflows to a 40-character commit SHA`);
    } else if (node.uses.startsWith('./') && (node.uses.split('/').includes('..') || node.uses.includes('${{'))) {
      problems.push(`${path}.uses: local actions must stay inside the repository`);
    }
    if (typeof node.uses === 'string' && node.uses.startsWith('actions/checkout@') && node.with?.['persist-credentials'] !== false) {
      problems.push(`${path}.with: set checkout persist-credentials to false`);
    }
    if (typeof node.uses === 'string' && /^actions\/(?:upload|download)-artifact@/.test(node.uses) && !safeArtifactPath(node.with?.path)) {
      problems.push(`${path}.with.path: artifact path must stay under output/ or dist/ and exclude credential files`);
    }
  });
}

function triggers(data) {
  if (typeof data.on === 'string') return [data.on];
  if (Array.isArray(data.on)) return data.on;
  return object(data.on) ? Object.keys(data.on) : [];
}

function hasAncestor(jobs, jobId, ancestor, seen = new Set()) {
  if (seen.has(jobId)) return false;
  seen.add(jobId);
  return needs(jobs[jobId]).some(id => id === ancestor || hasAncestor(jobs, id, ancestor, seen));
}

function checkRelease(data, file, problems) {
  const jobs = data.jobs;
  if (triggers(data).length !== 1 || !triggers(data).includes('workflow_dispatch')) problems.push(`${file}.on: releases require workflow_dispatch only`);
  const context = jobs.context;
  const mainCondition = typeof context?.if === 'string' && /github\.ref\s*==\s*(['"])refs\/heads\/main\1/.test(context.if) && !context.if.includes('||');
  const mainValidation = Array.isArray(context?.steps) && context.steps.some(step => !step.if && typeof step.run === 'string' && /^\s*node scripts\/ci\/release\.mjs context\s*$/m.test(step.run) && !/\|\||\bset\s+\+e\b/.test(step.run));
  if (!object(context) || (!mainCondition && !mainValidation)) {
    problems.push(`${file}.jobs.context: require a main-only context guard before verification`);
  }
  const verificationIds = Object.keys(jobs).filter(id => jobs[id]?.uses === './.github/workflows/ci.yml');
  if (!verificationIds.length) problems.push(`${file}.jobs: releases must call the reusable CI verification workflow`);
  for (const id of verificationIds) {
    if (!hasAncestor(jobs, id, 'context')) problems.push(`${file}.jobs.${id}.needs: CI verification must depend on context validation`);
  }
  if (usesSecrets(data.env)) problems.push(`${file}.env: credentials belong to protected jobs, never global workflow environment`);
  for (const [id, job] of Object.entries(jobs)) {
    if (!usesSecrets(job)) continue;
    const environment = typeof job.environment === 'string' ? job.environment : job.environment?.name;
    if (typeof environment !== 'string' || !environment.trim()) problems.push(`${file}.jobs.${id}.environment: credential-bearing jobs require a protected environment`);
    if (!verificationIds.some(verifyId => hasAncestor(jobs, id, verifyId))) problems.push(`${file}.jobs.${id}.needs: credential-bearing jobs must depend on CI verification`);
    if (typeof job.if === 'string' && /\b(?:always|failure|cancelled)\s*\(/.test(job.if)) problems.push(`${file}.jobs.${id}.if: releases cannot run after failed or cancelled verification`);
  }
}

export function validateWorkflow(source, file) {
  const problems = [];
  const data = parse(source, file, problems);
  if (!data) return problems;
  checkShared(data, file, problems);
  if (!readOnly(data.permissions, true)) problems.push(`${file}.permissions: declare read-only contents: read (optional actions: read)`);
  if (triggers(data).some(name => ['pull_request_target', 'workflow_run'].includes(name))) problems.push(`${file}.on: privileged trigger is forbidden for repository automation`);
  if (!object(data.jobs) || !Object.keys(data.jobs).length) {
    problems.push(`${file}.jobs: a nonempty job mapping is required`);
    return problems;
  }
  const ci = /(?:^|\/)ci\.ya?ml$/.test(file);
  for (const [id, job] of Object.entries(data.jobs)) {
    if (!object(job)) {
      problems.push(`${file}.jobs.${id}: a job mapping is required`);
      continue;
    }
    if (job.uses) continue;
    const maximum = ci ? 15 : 60;
    if (!Number.isInteger(job['timeout-minutes']) || job['timeout-minutes'] < 1 || job['timeout-minutes'] > maximum) {
      problems.push(`${file}.jobs.${id}.timeout-minutes: set an integer from 1 to ${maximum}`);
    }
    if (!job['runs-on'] || JSON.stringify(job['runs-on']).includes('self-hosted')) problems.push(`${file}.jobs.${id}.runs-on: declare a GitHub-hosted runner for untrusted repository code`);
  }
  if (ci) {
    if (usesSecrets(data)) problems.push(`${file}: CI must remain secret-free for fork pull requests`);
    for (const trigger of ['pull_request', 'push', 'merge_group', 'workflow_call', 'workflow_dispatch', 'schedule']) {
      if (!triggers(data).includes(trigger)) problems.push(`${file}.on: keep the ${trigger} verification trigger`);
    }
    for (const trigger of ['pull_request', 'push']) {
      if (object(data.on?.[trigger]) && ['paths', 'paths-ignore'].some(key => Object.hasOwn(data.on[trigger], key))) problems.push(`${file}.on.${trigger}: path filters cannot skip mandatory CI`);
    }
    const gate = data.jobs.gate;
    if (gate?.name !== 'Ready to merge' || !/^\s*(?:\$\{\{\s*)?always\(\)\s*(?:\}\})?\s*$/.test(gate?.if ?? '')) problems.push(`${file}.jobs.gate: keep Ready to merge with if: always()`);
    const required = Object.keys(data.jobs).filter(id => id !== 'gate').sort();
    const dependencies = [...new Set(needs(gate))].sort();
    if (JSON.stringify(required) !== JSON.stringify(dependencies)) problems.push(`${file}.jobs.gate.needs: include every other job in the merge gate`);
  } else if (usesSecrets(data) || /(?:^|\/)(?:release|native-build)\.ya?ml$/.test(file)) checkRelease(data, file, problems);
  return problems;
}

export function validateCompositeAction(source, file) {
  const problems = [];
  const data = parse(source, file, problems);
  if (!data) return problems;
  checkShared(data, file, problems);
  if (usesSecrets(data)) problems.push(`${file}: composite actions must remain secret-free`);
  if (data.runs?.using !== 'composite' || !Array.isArray(data.runs.steps)) problems.push(`${file}.runs: expected a composite action with steps`);
  return problems;
}

export function validateMigrationCoverage(migrations, source) {
  // Use the existing compiler to distinguish real calls from comments/examples.
  const script = ts.createSourceFile('test-bee-db.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const covered = new Set();
  function inspect(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fixture' && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) covered.add(node.arguments[0].text);
    ts.forEachChild(node, inspect);
  }
  inspect(script);
  return migrations.filter(path => !covered.has(path)).map(path => `${path}: add this migration to scripts/test-bee-db.mjs fixture coverage`);
}

function discover(root, directory, match) {
  const folder = join(root, directory);
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discover(root, path, match);
    return entry.isFile() && match(entry.name) ? [path] : [];
  }).sort();
}

export function inspectRepository(root = repositoryRoot) {
  const problems = [];
  const workflows = discover(root, '.github/workflows', name => /\.ya?ml$/.test(name));
  if (!workflows.some(path => /(?:^|\/)ci\.ya?ml$/.test(path))) problems.push('.github/workflows/ci.yml: the required verification workflow is missing');
  for (const file of workflows) problems.push(...validateWorkflow(readFileSync(join(root, file), 'utf8'), file));
  for (const file of discover(root, '.github/actions', name => /^action\.ya?ml$/.test(name))) problems.push(...validateCompositeAction(readFileSync(join(root, file), 'utf8'), file));
  const databaseTests = join(root, 'scripts/test-bee-db.mjs');
  if (!existsSync(databaseTests)) problems.push('scripts/test-bee-db.mjs: database fixture runner is missing');
  else problems.push(...validateMigrationCoverage(discover(root, 'supabase/migrations', name => name.endsWith('.sql')), readFileSync(databaseTests, 'utf8')));
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const problems = inspectRepository();
    if (problems.length) {
      for (const problem of problems) process.stderr.write(`Workflow policy: ${problem}\n`);
      process.exitCode = 1;
    } else process.stdout.write('Workflow policy passed.\n');
  } catch {
    process.stderr.write('Workflow policy: repository files could not be inspected; check file permissions and structure.\n');
    process.exitCode = 1;
  }
}
