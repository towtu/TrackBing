import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { exportDirectories, hasSecret, scanRepository } from '../check-secrets.mjs';

const script = fileURLToPath(new URL('../check-secrets.mjs', import.meta.url));
const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('secret scanner boundaries', () => {
  const jwt = (role: string) => `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixtureSignature`;
  const credential = ['sb', 'secret', 'x'.repeat(24)].join('_');
  it('detects server JWTs while allowing the public anon role', () => {
    expect(hasSecret(jwt('service_role'))).toBe(true);
    expect(hasSecret(jwt('supabase_admin'))).toBe(true);
    expect(hasSecret(jwt('anon'))).toBe(false);
  });
  it('detects server key formats and prohibited public variables', () => {
    for (const value of [credential, ['AI', 'za', 'x'.repeat(35)].join(''), ['sk', 'x'.repeat(40)].join('-'), ['sk', 'live', 'x'.repeat(24)].join('_'), ['EXPO', 'PUBLIC', 'GEMINI', 'API', 'KEY'].join('_')]) expect(hasSecret(value)).toBe(true);
    expect(hasSecret(['sb', 'publishable', 'x'.repeat(24)].join('_'))).toBe(false);
  });
  it.each([['--missing'], ['--export-dir'], ['--export-dir', '../../private'], ['--export-dir', '/private'], ['--export-dir', '--dist']].map(args => ({ args })))('rejects malformed or escaping arguments $args', ({ args }) => expect(() => exportDirectories(args)).toThrow());
  it('uses actual Git NUL-delimited names and scans tracked environment files plus Hermes exports', () => {
    const root = temporaryRoot();
    expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0);
    writeFileSync(join(root, 'name with space.js'), 'const safe = true;');
    writeFileSync(join(root, '.env.local'), 'TEST_DATA=fixture');
    writeFileSync(join(root, '.env.example'), 'PUBLIC_FIXTURE=placeholder');
    spawnSync('git', ['add', '--force', '.env.local', '.env.example', 'name with space.js'], { cwd: root });
    mkdirSync(join(root, 'output/native'), { recursive: true });
    writeFileSync(join(root, 'output/native/entry.hbc'), `binary\u0000${credential}`);
    const result = scanRepository(root, ['--export-dir', 'output/native']);
    expect(result.files).toBe(4);
    expect(result.findings.map(finding => finding.file)).toEqual(['.env.local', 'output/native/entry.hbc']);
    const cli = spawnSync(process.execPath, [script, '--export-dir', 'output/native'], { cwd: root, encoding: 'utf8' });
    expect(cli.status).toBe(1);
    expect(cli.stderr).not.toContain(credential);
    expect(cli.stderr).toContain('entry.hbc');
  });
  it('fails closed without Git, on a missing export, and for invalid CLI arguments', () => {
    const root = temporaryRoot();
    expect(scanRepository.bind(null, root, [])).toThrow();
    spawnSync('git', ['init', '-q'], { cwd: root });
    for (const args of [['--dist'], ['--unknown']]) {
      const cli = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
      expect(cli.status).toBe(1);
      expect(cli.stderr).not.toContain(root);
    }
  });
  it('rejects a directory escaping through a symlink ancestor', () => {
    const root = temporaryRoot();
    const outside = temporaryRoot();
    spawnSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(join(outside, 'export'));
    symlinkSync(outside, join(root, 'link'), 'dir');
    expect(() => scanRepository(root, ['--export-dir', 'link/export'])).toThrow('inside');
  });
});

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'trackbing-secrets-'));
  temporaryRoots.push(root);
  return root;
}

describe('secret scanner import', () => {
  it('can be imported outside a Git repository without scanning or printing', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../check-secrets.mjs', import.meta.url).href)})`], { cwd: temporaryRoot(), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
