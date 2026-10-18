import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';

const patterns = [
  /AIza[0-9A-Za-z_-]{30,}/,
  /\bsk_(?:live|test)_[0-9a-zA-Z]{24,}\b/,
  /\bsk-[0-9a-zA-Z]{32,}\b/,
  /\bsb_secret_[0-9A-Za-z_-]{20,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /EXPO_PUBLIC_(?:GEMINI|DEEPSEEK|TAVILY|USDA)_API_KEY/,
  /EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY\s*[=:]\s*["']?eyJ/,
];

export function hasSecret(text) {
  if (patterns.some(pattern => pattern.test(text))) return true;
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString());
      if (payload.role === 'service_role' || payload.role === 'supabase_admin') return true;
    } catch { /* A string that is not a JWT is not a credential finding. */ }
  }
  return false;
}

export function exportDirectories(args) {
  const directories = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dist') directories.push('dist');
    else if (args[i] === '--export-dir' && typeof args[i + 1] === 'string') {
      const value = args[++i];
      if (!value || value.startsWith('-') || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..')) throw new Error('Choose a relative export directory inside the repository.');
      directories.push(value);
    } else throw new Error('Use --dist or --export-dir <relative directory>.');
  }
  return [...new Set(directories)];
}

export function scanRepository(root = process.cwd(), args = []) {
  // Git separates names with actual NUL bytes, including filenames with spaces.
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: 10 * 1024 * 1024 }).split('\0').filter(Boolean);
  const files = new Set(tracked);
  function walk(folder) {
    const full = resolve(root, folder);
    if (relative(root, full).startsWith('..') || relative(realpathSync(root), realpathSync(full)).startsWith('..') || lstatSync(full).isSymbolicLink() || !lstatSync(full).isDirectory()) throw new Error('Export directory must be an existing directory inside the repository.');
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Export symlinks are not supported by the secret scanner.');
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.add(path);
    }
  }
  for (const directory of exportDirectories(args)) walk(directory);
  const findings = [];
  for (const file of files) {
    if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example')) findings.push({ file, reason: 'Real environment file tracked' });
    if (/\.(?:png|ico|jpe?g|avif|webp|gif|ttf|woff2?|zip)$/.test(file)) continue;
    const stat = lstatSync(join(root, file));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error('A scan file is unsupported or exceeds the 32 MiB limit.');
    // Hermes bundles keep string constants readable; do not skip .hbc files.
    if (hasSecret(readFileSync(join(root, file), 'utf8'))) findings.push({ file, reason: 'Potential server secret; inspect locally and rotate if real' });
  }
  return { files: files.size, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = scanRepository(process.cwd(), process.argv.slice(2));
    for (const finding of result.findings) console.error(`${finding.reason}: ${JSON.stringify(finding.file)}. No values printed.`);
    if (result.findings.length) process.exitCode = 1;
    else console.log(`Secret patterns checked in ${result.files} tracked/export files; no values printed. Pattern scanning does not prove absence of every credential format or inspect Git history.`);
  } catch {
    console.error('Secret scan failed: check Git access, arguments, export directories and file limits. No file contents or provider errors printed.');
    process.exitCode = 1;
  }
}
