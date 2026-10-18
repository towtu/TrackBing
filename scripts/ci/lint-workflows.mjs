import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

// Verified against the official release's published checksums, 4 October 2026.
const url = 'https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz';
const checksum = '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8';
try {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Workflow lint currently requires Linux x64 (or a compatible container).');
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('Could not download the pinned workflow linter.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 30_000_000 || createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Workflow linter checksum mismatch.');
  mkdirSync('output/ci-tools', { recursive: true });
  writeFileSync('output/ci-tools/actionlint.tar.gz', bytes);
  const extracted = spawnSync('tar', ['-xzf', 'output/ci-tools/actionlint.tar.gz', '-C', 'output/ci-tools', 'actionlint'], { stdio: 'inherit' });
  if (extracted.status !== 0) throw new Error('Workflow linter extraction failed.');
  chmodSync('output/ci-tools/actionlint', 0o700);
  // actionlint validates YAML, expressions, contexts and shell scripts when
  // shellcheck is installed. Never execute the deployment workflows locally.
  const result = spawnSync('output/ci-tools/actionlint', ['-color'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Workflow lint failed.');
  process.exitCode = 1;
}
