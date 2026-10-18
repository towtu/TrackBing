// Run the existing controlled browser suites against one local web export.
/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { serveExport } = require('../serve-web-export.cjs');

const root = path.resolve(__dirname, '../..');
const suites = Object.freeze({
  web: 'check-web-ui.cjs',
  auth: 'check-auth-ui.cjs',
  account: 'check-account-ux.cjs',
  cookbook: 'check-cookbook-ui.cjs',
  motion: 'check-bee-motion.cjs',
  creation: 'check-bee-creation-ui.cjs',
});
const suiteTimeoutMs = 180_000;

function parseSuites(args = []) {
  if (args.length === 0 || (args.length === 1 && ['all', '--all'].includes(args[0]))) return Object.keys(suites);
  for (const name of args) {
    if (!Object.hasOwn(suites, name)) throw new Error(`Unknown browser suite: ${name}. Choose ${Object.keys(suites).join(', ')} or --all.`);
  }
  return [...new Set(args)];
}

function requireExport(directory = path.join(root, 'dist')) {
  const entry = path.join(directory, 'index.html');
  if (!fs.existsSync(entry) || !fs.statSync(entry).isFile()) throw new Error('Web export is missing. Run npm run build:web before ci:browser.');
}

/** @param {Record<string, string | undefined>} [env] */
function resolveBrowser(env = process.env) {
  const executable = env.CHROME_BIN || require(env.PLAYWRIGHT_MODULE || 'playwright').chromium.executablePath();
  try {
    fs.accessSync(executable, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    if (!fs.statSync(executable).isFile()) throw new Error('Not a file');
  } catch {
    throw new Error('Chromium is missing or not executable. Run npx playwright install chromium, or set CHROME_BIN to an executable path.');
  }
  return path.resolve(executable);
}

function stopChildTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // Windows has no POSIX process groups. taskkill also closes browser descendants.
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0 && child.exitCode === null && child.signalCode === null) throw new Error('Could not stop the browser suite process tree.');
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

/**
 * @param {string} script
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<void>}
 */
function runCheck(script, { cwd = root, env = process.env, timeoutMs = suiteTimeoutMs, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Browser checks cancelled.'));
    const child = spawn(process.execPath, [script], { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32', windowsHide: true });
    let termination, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      try { stopChildTree(child); } catch (cleanupError) { error ||= cleanupError; }
      if (error) reject(error); else resolve();
    };
    const stop = reason => {
      termination = new Error(reason);
      try { stopChildTree(child); } catch (error) { finish(error); }
    };
    const cancel = () => stop('Browser checks cancelled.');
    const timer = setTimeout(() => stop(`Browser suite ${path.basename(script)} timed out after ${timeoutMs / 1000}s.`), timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    child.once('error', finish);
    child.once('close', (code, childSignal) => finish(termination || (code === 0 ? null : new Error(`Browser suite ${path.basename(script)} failed with ${childSignal ? `signal ${childSignal}` : `exit code ${code}`}.`))));
    if (signal?.aborted) cancel();
  });
}

async function runBrowser(args = process.argv.slice(2), env = process.env) {
  const selected = parseSuites(args);
  requireExport();
  const executable = resolveBrowser(env);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let local;
  try {
    local = await serveExport();
    const childEnv = { ...env, CHROME_BIN: executable, UI_BASE_URL: local.base };
    for (const name of selected) {
      console.log(`Browser suite ${name}: 375px / 768px / 1440px`);
      await runCheck(path.join(root, 'scripts', suites[name]), { env: childEnv, signal: controller.signal });
    }
    console.log(`Browser checks passed: ${selected.join(', ')}.`);
  } finally {
    if (local) {
      local.server.closeAllConnections();
      await new Promise((resolve, reject) => local.server.close(error => error ? reject(error) : resolve()));
    }
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

module.exports = { parseSuites, requireExport, resolveBrowser, runCheck, runBrowser };
if (require.main === module) {
  runBrowser().catch(error => { console.error(error.message); process.exitCode = 1; });
}
