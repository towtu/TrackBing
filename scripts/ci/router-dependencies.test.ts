import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Test the actual CommonJS interfaces consumed by Expo Router and Babel tooling.
const require = createRequire(import.meta.url);
const routerRequire = createRequire(require.resolve('expo-router/package.json'));
const queryString = routerRequire('query-string');

describe('router query decoding', () => {
  it('installs the reviewed decoder as a normal auditable package without scripts', () => {
    const queryRequire = createRequire(routerRequire.resolve('query-string'));
    const installed = queryRequire.resolve('decode-uri-component');
    const root = dirname(installed);
    expect(lstatSync('node_modules/decode-uri-component').isSymbolicLink()).toBe(false);
    expect(root).toBe(resolve('node_modules/decode-uri-component'));
    expect(readFileSync(installed)).toEqual(readFileSync('vendor/decode-uri-component/index.cjs'));
    expect(readFileSync(join(root, 'LICENSE'))).toEqual(readFileSync('vendor/decode-uri-component/LICENSE'));
    expect(readFileSync(join(root, 'UPSTREAM.md'))).toEqual(readFileSync('vendor/decode-uri-component/UPSTREAM.md'));
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(manifest).toEqual(JSON.parse(readFileSync('vendor/decode-uri-component/package.json', 'utf8')));
    expect(manifest.scripts).toBeUndefined();
    // npm excludes links and link targets from its registry advisory query.
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(lock.packages['node_modules/decode-uri-component'].link).not.toBe(true);
  });

  it('retains the exact licensed upstream decoder except for its CommonJS export', () => {
    const source = readFileSync('vendor/decode-uri-component/index.cjs', 'utf8');
    expect(source.match(/module\.exports = function decodeUriComponent\(/g)).toHaveLength(1);
    const upstream = source.replace('module.exports = function decodeUriComponent(', 'export default function decodeUriComponent(');
    expect(createHash('sha256').update(upstream).digest('hex')).toBe('9401353df38f8010ad7035fe8d666bce6a4902bc1cff809afc4ab23fa2e0bdaa');
    expect(createHash('sha256').update(readFileSync('vendor/decode-uri-component/LICENSE')).digest('hex')).toBe('ed7a9a0f74e43951b2520efe1a4349cb9ed5f3dff0b0f268e2e51a4d38df7ea4');
  });

  it('finishes a long malformed percent-encoded query without blocking query decoding', () => {
    // Synthetic adversarial test input for GHSA-vcc3-ghjq-m6fr. Bound the
    // isolated process so an unpatched dependency cannot hang the test runner.
    const child = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
      const assert = require('node:assert/strict');
      const { createRequire } = require('node:module');
      const routerRequire = createRequire(require.resolve('expo-router/package.json'));
      const input = '%FF'.repeat(4000);
      assert.equal(routerRequire('query-string').parse('food=' + input).food, input);
    `], { timeout: 2000, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 4096 });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
  });

  it('round-trips food names, barcode text, repeated values and recovery redirect parameters', () => {
    const params = {
      food: 'TEST DATA: ginataang kalabasa 🍲', barcode: '4801234567890',
      redirect_to: 'https://trackbing.example/recover?code=a+b&next=/profile',
      portion: ['72 g', '100 g'], literal: '+ & = % / #',
    };
    expect({ ...queryString.parse(queryString.stringify(params)) }).toEqual(params);
    expect(queryString.parse('food=chicken+breast&literal=%2B').food).toBe('chicken breast');
    expect(queryString.parse('food=chicken+breast&literal=%2B').literal).toBe('+');
  });

  it.each([
    ['%C3%A5%FF', 'å%FF'], ['%E0%A4%A', '%E0%A4%A'], ['%FE%FF', '\uFFFD\uFFFD'],
    ['%', '%'], ['%GG', '%GG'], ['%F0%9F%8D%B2', '🍲'],
  ])('handles malformed or multibyte input %s deterministically', (encoded, decoded) => {
    expect(queryString.parse(`food=${encoded}`).food).toBe(decoded);
  });
});

describe('coverage configuration loader', () => {
  const { loadNycConfig, isLoading } = require('@istanbuljs/load-nyc-config');

  it('loads inherited YAML configuration through the existing loader', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'trackbing-nyc-'));
    try {
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture' }));
      writeFileSync(join(cwd, 'base.yml'), 'all: true\nexclude: ["vendor/**"]\n');
      writeFileSync(join(cwd, '.nycrc.yml'), 'extends: ./base.yml\ninclude: ["src/**/*.ts"]\nreporter: text\n');
      expect(await loadNycConfig({ cwd })).toMatchObject({ all: true, exclude: ['vendor/**'], include: ['src/**/*.ts'], reporter: 'text' });
      expect(isLoading()).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('rejects JavaScript YAML tags without leaving the loader in an active state', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'trackbing-nyc-'));
    try {
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'fixture' }));
      writeFileSync(join(cwd, '.nycrc.yml'), 'custom: !!js/function "function () { return 1; }"\n');
      await expect(loadNycConfig({ cwd })).rejects.toThrow();
      expect(isLoading()).toBe(false);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
