import { describe, expect, it } from 'vitest';

import { evaluateAudit } from './audit.mjs';

type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

const now = new Date('2026-10-04T12:00:00.000Z');
const knownId = 'GHSA-vfj7-8cjw-p6xm';
const unknownId = 'GHSA-5p2g-fcmc-qvqq';

function advisory(packageName = 'braces', id = knownId, severity: Severity = 'high') {
  return {
    name: packageName,
    dependency: packageName,
    url: `https://github.com/advisories/${id}`,
    severity,
    source: 1234,
    title: 'Untrusted text must not appear in the artifact or logs',
  };
}

type Advisory = ReturnType<typeof advisory>;

function vulnerability(name: string, via: (string | Advisory)[], severity: Severity = 'high') {
  return { name, severity, via };
}

type Vulnerability = ReturnType<typeof vulnerability>;

function report(entries: Vulnerability[] = []) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: entries.length };
  for (const entry of entries) counts[entry.severity]++;
  return {
    auditReportVersion: 2,
    vulnerabilities: Object.fromEntries(entries.map((entry) => [entry.name, entry])),
    metadata: { vulnerabilities: counts },
  };
}

function command(entries: Vulnerability[] = []) {
  return { status: entries.length > 0 ? 1 : 0, stdout: JSON.stringify(report(entries)) };
}

function exception(packageName = 'braces', id = knownId) {
  return {
    package: packageName,
    advisory: id,
    severity: 'high',
    owner: 'towtu',
    reason: 'Temporary acknowledgement while a compatible dependency fix is verified.',
    expires: '2026-10-18',
  };
}

function policy(exceptions = [exception()]) {
  return { version: 1, exceptions };
}

const known = vulnerability('braces', [advisory()]);

describe('dependency audit policy', () => {
  it('passes a clean audit and reports all severity totals', () => {
    const result = evaluateAudit(command(), policy([]), now);
    expect(result.status).toBe('passed');
    expect(result.totals).toEqual({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 });
    expect(result.advisories).toEqual([]);
  });

  it('acknowledges the exact high advisory without calling it a clean audit', () => {
    const result = evaluateAudit(command([known]), policy(), now);
    expect(result.status).toBe('passed');
    expect(result.totals?.high).toBe(1);
    expect(result.advisories).toEqual([
      expect.objectContaining({ package: 'braces', advisory: knownId, severity: 'high', decision: 'exception' }),
    ]);
    expect(result.acknowledgedHighAdvisories).toBe(1);
  });

  it('blocks an unlisted high advisory', () => {
    const result = evaluateAudit(command([vulnerability('braces', [advisory('braces', unknownId)])]), policy(), now);
    expect(result.status).toBe('failed');
    expect(result.advisories[0].decision).toBe('block');
  });

  it('does not reuse an exception for the same advisory in a different package', () => {
    const result = evaluateAudit(command([vulnerability('image-size', [advisory('image-size')])]), policy(), now);
    expect(result.status).toBe('failed');
  });

  it('checks every advisory when a package has more than one', () => {
    const result = evaluateAudit(command([vulnerability('braces', [advisory(), advisory('braces', unknownId)])]), policy(), now);
    expect(result.status).toBe('failed');
    expect(result.advisories).toHaveLength(2);
    expect(result.acknowledgedHighAdvisories).toBe(1);
  });

  it('always blocks critical findings, including an advisory previously acknowledged as high', () => {
    const result = evaluateAudit(command([vulnerability('braces', [advisory('braces', knownId, 'critical')], 'critical')]), policy(), now);
    expect(result.status).toBe('failed');
    expect(result.advisories[0].decision).toBe('block');
    expect(result.acknowledgedHighAdvisories).toBe(0);
  });

  it('reports moderate findings without bypassing the high/critical gate', () => {
    const result = evaluateAudit(command([vulnerability('braces', [advisory('braces', knownId, 'moderate')], 'moderate')]), policy([]), now);
    expect(result.status).toBe('passed');
    expect(result.advisories[0].decision).toBe('report');
    expect(result.totals?.moderate).toBe(1);
  });

  it('rejects expired exceptions even when the dependency has disappeared', () => {
    const result = evaluateAudit(command(), policy(), new Date('2026-10-19T00:00:00.000Z'));
    expect(result.status).toBe('error');
    expect(result.problems.join(' ')).toContain('expired');
  });

  it.each([null, policy()])('keeps validated blockers visible when policy validation fails %#', (invalidPolicy) => {
    const forgeId = 'GHSA-86w9-cpqp-85rv';
    const result = evaluateAudit(command([
      known,
      vulnerability('node-forge', [advisory('node-forge', forgeId)]),
    ]), invalidPolicy, new Date('2026-10-19T00:00:00.000Z'));
    expect(result.status).toBe('error');
    expect(result.acknowledgedHighAdvisories).toBe(0);
    expect(result.advisories).toEqual([
      { package: 'braces', advisory: knownId, severity: 'high', decision: 'block' },
      { package: 'node-forge', advisory: forgeId, severity: 'high', decision: 'block' },
    ]);
    expect(JSON.stringify(result)).not.toContain(advisory().title);
    expect(result.problems.length).toBeGreaterThan(0);
  });

  it('expires at the start of the stated UTC date', () => {
    expect(evaluateAudit(command([known]), policy(), new Date('2026-10-17T23:59:59.999Z')).status).toBe('passed');
    expect(evaluateAudit(command([known]), policy(), new Date('2026-10-18T00:00:00.000Z')).status).toBe('error');
  });

  it.each([
    { ...exception(), expires: '2026-02-30' },
    { ...exception(), expires: 'next week' },
    { ...exception(), owner: '' },
    { ...exception(), owner: 'unassigned' },
    { ...exception(), reason: '' },
    { ...exception(), advisory: 'github.com' },
    { ...exception(), package: '*' },
    { ...exception(), severity: 'critical' },
    { ...exception(), unexpected: true },
  ])('rejects an invalid exception %#', (invalidException) => {
    expect(evaluateAudit(command([known]), policy([invalidException]), now).status).toBe('error');
  });

  it('rejects duplicate exceptions', () => {
    expect(evaluateAudit(command([known]), policy([exception(), exception()]), now).status).toBe('error');
  });

  it('rejects non-string advisory identifiers rather than coercing them', () => {
    const invalidPolicy = { version: 1, exceptions: [{ ...exception(), advisory: [knownId] }] };
    expect(evaluateAudit(command([known]), invalidPolicy, now).status).toBe('error');
  });

  it.each([null, [], {}, { version: 2, exceptions: [] }, { version: 1, exceptions: [] , broadBypass: true }])('rejects invalid policy shape %#', (invalidPolicy) => {
    expect(evaluateAudit(command(), invalidPolicy, now).status).toBe('error');
  });

  it('resolves inherited findings to the exact advisory at the end of the chain', () => {
    const result = evaluateAudit(command([
      vulnerability('expo', ['metro']),
      vulnerability('metro', ['micromatch']),
      vulnerability('micromatch', ['braces']),
      known,
    ]), policy(), now);
    expect(result.status).toBe('passed');
    expect(result.totals?.high).toBe(4);
    expect(result.advisories).toHaveLength(1);
  });

  it('resolves legitimate inherited cycles that reach a real advisory', () => {
    const result = evaluateAudit(command([
      vulnerability('metro', ['metro-config', 'braces']),
      vulnerability('metro-config', ['metro']),
      known,
    ]), policy(), now);
    expect(result.status).toBe('passed');
    expect(result.advisories).toHaveLength(1);
  });

  it('blocks unknown advisories through inherited branches', () => {
    const result = evaluateAudit(command([
      vulnerability('expo', ['braces', 'image-size']),
      known,
      vulnerability('image-size', [advisory('image-size', unknownId)]),
    ]), policy(), now);
    expect(result.status).toBe('failed');
    expect(result.advisories.find((item) => item.package === 'image-size')?.decision).toBe('block');
  });

  it.each([
    { entries: [vulnerability('expo', ['missing-package'])] },
    { entries: [vulnerability('expo', [])] },
    { entries: [vulnerability('metro', ['metro-config']), vulnerability('metro-config', ['metro'])] },
    { entries: [vulnerability('metro', ['metro'])] },
    { entries: [vulnerability('expo', ['braces', 'loop']), known, vulnerability('loop', ['loop'])] },
    { entries: [vulnerability('expo', ['braces']), vulnerability('braces', [advisory('braces', knownId, 'moderate')], 'moderate')] },
    { entries: [vulnerability('braces', [advisory()], 'moderate')] },
    { entries: [vulnerability('braces', [advisory('different-package')])] },
  ])('fails closed on an unresolved or inconsistent inherited graph %#', ({ entries }) => {
    expect(evaluateAudit(command(entries), policy(), now).status).toBe('error');
  });

  it('fails closed when audit metadata hides a high finding', () => {
    const malformed = report([known]);
    malformed.metadata.vulnerabilities.high = 0;
    malformed.metadata.vulnerabilities.total = 0;
    expect(evaluateAudit({ status: 1, stdout: JSON.stringify(malformed) }, policy(), now).status).toBe('error');
  });

  it.each([
    { auditReportVersion: 1, vulnerabilities: {}, metadata: { vulnerabilities: {} } },
    { auditReportVersion: 2, vulnerabilities: null, metadata: { vulnerabilities: {} } },
    { auditReportVersion: 2, vulnerabilities: [], metadata: { vulnerabilities: {} } },
    { ...report(), metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: -1, critical: 0, total: -1 } } },
    { ...report(), vulnerabilities: { braces: { ...known, severity: 'unknown' } } },
    { ...report([known]), vulnerabilities: { braces: { ...known, name: 'different-package' } } },
    { ...report([known]), vulnerabilities: { braces: { ...known, via: [null] } } },
    { ...report([known]), vulnerabilities: { braces: { ...known, via: [{ ...advisory(), url: 'https://untrusted.invalid/GHSA-vfj7-8cjw-p6xm' }] } } },
  ])('fails closed on malformed audit reports %#', (malformed) => {
    expect(evaluateAudit({ status: 1, stdout: JSON.stringify(malformed) }, policy(), now).status).toBe('error');
  });

  it('handles a normal npm vulnerability exit code without treating it as a tool error', () => {
    expect(evaluateAudit({ ...command([known]), status: 1 }, policy(), now).status).toBe('passed');
  });

  it.each([
    { status: 1, stdout: JSON.stringify({ error: { code: 'EAI_AGAIN', message: 'sensitive registry response' } }) },
    { status: 1, stdout: JSON.stringify({ ...report(), error: { code: 'E403', message: 'sensitive registry response' } }) },
    { status: 1, stdout: 'sensitive registry response' },
    { ...command(), status: 2 },
    { ...command(), status: null, signal: 'SIGTERM' },
    { ...command(), error: new Error('sensitive registry response') },
    { ...command(), status: 1 },
    { ...command([known]), status: 0 },
  ])('fails closed on execution or registry failure %# without exposing response bodies', (execution) => {
    const result = evaluateAudit(execution, policy(), now);
    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain('sensitive registry response');
  });

  it('excludes untrusted advisory descriptions from its report', () => {
    const result = evaluateAudit(command([known]), policy(), now);
    expect(JSON.stringify(result)).not.toContain(advisory().title);
  });
});
