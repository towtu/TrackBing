import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseSuites, requireExport, resolveBrowser, runCheck } from './browser.cjs';

const directories: string[] = [];
const suiteNames = ['web', 'auth', 'account', 'cookbook', 'motion', 'creation'];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'trackbing-browser-'));
  directories.push(directory);
  return directory;
}

function checkScript(source: string) {
  const directory = temporaryDirectory();
  const script = join(directory, 'check.cjs');
  writeFileSync(script, source);
  return { directory, script };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('browser CI runner', () => {
  it.each([[], ['all'], ['--all']].map(args => ({ args })))('runs all existing suites for $args', ({ args }) => {
    expect(parseSuites(args)).toEqual(suiteNames);
  });

  it('accepts selected suites in the requested order without duplicate execution', () => {
    expect(parseSuites(['creation', 'auth', 'creation'])).toEqual(['creation', 'auth']);
  });

  it.each([['missing'], ['../check-auth-ui.cjs'], ['--all', 'auth'], ['all', '--unknown'], ['--suite']].map(args => ({ args })))('rejects invalid or ambiguous CLI arguments $args', ({ args }) => {
    expect(() => parseSuites(args)).toThrow();
  });

  it('fails when the common web export is missing', () => {
    expect(() => requireExport(temporaryDirectory())).toThrow(/build:web/);
  });

  it('requires a real export entry point', () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, 'index.html'), '<html></html>');
    expect(() => requireExport(directory)).not.toThrow();
  });

  it('uses an explicit browser override and rejects a missing executable', () => {
    expect(resolveBrowser({ CHROME_BIN: process.execPath })).toBe(process.execPath);
    expect(() => resolveBrowser({ CHROME_BIN: join(temporaryDirectory(), 'missing-chromium') })).toThrow(/playwright install chromium/);
  });

  it('resolves a relative browser override before changing the child working directory', () => {
    expect(resolveBrowser({ CHROME_BIN: relative(process.cwd(), process.execPath) })).toBe(process.execPath);
  });

  it('uses the selected Playwright module to find its bundled Chromium', () => {
    const { script } = checkScript(`module.exports = { chromium: { executablePath: () => ${JSON.stringify(process.execPath)} } };`);
    expect(resolveBrowser({ PLAYWRIGHT_MODULE: script })).toBe(process.execPath);
  });

  it('passes the shared export URL and portable browser to the actual child', async () => {
    const { script, directory } = checkScript("require('node:fs').writeFileSync('environment.json', JSON.stringify({ base: process.env.UI_BASE_URL, browser: process.env.CHROME_BIN }));");
    await runCheck(script, { cwd: directory, env: { ...process.env, UI_BASE_URL: 'http://127.0.0.1:43210', CHROME_BIN: process.execPath }, timeoutMs: 2000 });
    expect(JSON.parse(readFileSync(join(directory, 'environment.json'), 'utf8'))).toEqual({ base: 'http://127.0.0.1:43210', browser: process.execPath });
  });

  it('fails on a nonzero suite result', async () => {
    const { script } = checkScript('process.exitCode = 7;');
    await expect(runCheck(script, { timeoutMs: 2000 })).rejects.toThrow(/exit code 7/);
  });

  it('terminates a hung suite within its configured deadline', async () => {
    const { script } = checkScript('setInterval(() => {}, 1000);');
    await expect(runCheck(script, { timeoutMs: 100 })).rejects.toThrow(/timed out/);
  });

  it('terminates a running suite when the runner is cancelled', async () => {
    const { script } = checkScript('setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const result = runCheck(script, { timeoutMs: 2000, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toThrow(/cancelled/);
  });
});
