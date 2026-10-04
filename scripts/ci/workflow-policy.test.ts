import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { inspectRepository, validateCompositeAction, validateMigrationCoverage, validateWorkflow } from './workflow-policy.mjs';

const pin = 'a'.repeat(40);
const ciPath = '.github/workflows/ci.yml';
const actionPath = '.github/actions/setup-node/action.yml';
const ci = `name: CI
on:
  pull_request:
  push:
    branches: [main]
  merge_group:
  workflow_call:
  workflow_dispatch:
  schedule:
    - cron: '17 4 * * 1'
permissions:
  contents: read
concurrency:
  group: ci-example
  cancel-in-progress: true
jobs:
  app:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@${pin}
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup-node
      - run: npm test
      - uses: actions/upload-artifact@${pin}
        with:
          path: output/test-results/
  gate:
    name: Ready to merge
    if: always()
    needs: [app]
    runs-on: ubuntu-24.04
    timeout-minutes: 2
    steps:
      - run: echo verified
`;

const composite = `name: Dependencies
runs:
  using: composite
  steps:
    - uses: actions/setup-node@${pin}
      with:
        node-version-file: .nvmrc
    - shell: bash
      run: npm ci --no-audit
`;

const release = `name: Release
on:
  workflow_dispatch:
permissions:
  contents: read
  actions: read
jobs:
  context:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - run: node scripts/ci/release.mjs context
  verify:
    needs: context
    uses: ./.github/workflows/ci.yml
  deploy:
    needs: verify
    environment: production
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - run: node scripts/ci/release.mjs deploy
        env:
          DEPLOY_TOKEN: \${{ secrets.DEPLOY_TOKEN }}
`;

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function problems(source: string, path = ciPath) {
  return validateWorkflow(source, path).join('\n');
}

describe('workflow safety policy', () => {
  it('accepts secret-free verification and a guarded manual release', () => {
    expect(validateWorkflow(ci, ciPath)).toEqual([]);
    expect(validateWorkflow(release, '.github/workflows/release.yml')).toEqual([]);
    expect(validateCompositeAction(composite, actionPath)).toEqual([]);
  });

  it.each(['v7', 'main', 'a'.repeat(39)])('blocks mutable or incomplete external action pins: %s', (reference) => {
    expect(problems(ci.replace(`actions/checkout@${pin}`, `actions/checkout@${reference}`))).toContain('40-character commit SHA');
  });

  it('rejects malformed and duplicate-key YAML without printing source values', () => {
    for (const source of ['jobs: [invalid', 'permissions:\n  contents: read\n  contents: private-secret-value', 'jobs: &cycle { app: *cycle }']) {
      const result = problems(source);
      expect(result).toContain('valid YAML');
      expect(result).not.toContain('private-secret-value');
    }
  });

  it.each(['pull_request_target', 'workflow_run'])('blocks privileged automatic trigger %s', (trigger) => {
    expect(problems(ci.replace('  pull_request:', `  ${trigger}:`))).toContain('privileged trigger');
  });

  it('requires reusable and merge-queue CI triggers', () => {
    expect(problems(ci.replace('  workflow_call:\n', ''))).toContain('workflow_call');
    expect(problems(ci.replace('  merge_group:\n', ''))).toContain('merge_group');
  });

  it('rejects path filters that silently remove mandatory CI checks', () => {
    expect(problems(ci.replace('  pull_request:', '  pull_request:\n    paths: [src/**]'))).toContain('path filters');
  });

  it('rejects elevated workflow and job tokens', () => {
    expect(problems(ci.replace('  contents: read', '  contents: write'))).toContain('read-only');
    expect(problems(ci.replace('  app:\n', '  app:\n    permissions: write-all\n'))).toContain('read-only');
  });

  it('requires checkout to disable credential persistence', () => {
    expect(problems(ci.replace('persist-credentials: false', 'persist-credentials: true'))).toContain('persist-credentials');
    expect(problems(ci.replace('        with:\n          persist-credentials: false\n', ''))).toContain('persist-credentials');
  });

  it('rejects any CI secret context while keeping the value out of diagnostics', () => {
    const result = problems(ci.replace('npm test', 'echo ${{ secrets.PRIVATE_API_KEY }}'));
    expect(result).toContain('secret-free');
    expect(result).not.toContain('PRIVATE_API_KEY');
  });

  it('rejects a composite action that asks for secrets', () => {
    expect(validateCompositeAction(composite.replace('npm ci --no-audit', 'echo ${{ secrets.DEPLOY_TOKEN }}'), actionPath).join('\n')).toContain('secret-free');
  });

  it('applies checkout hardening and pinning inside composite actions too', () => {
    expect(validateCompositeAction(composite.replace('actions/setup-node', 'actions/checkout'), actionPath).join('\n')).toContain('persist-credentials');
    expect(validateCompositeAction(composite.replace(`@${pin}`, '@main'), actionPath).join('\n')).toContain('40-character commit SHA');
  });

  it.each(['output/../.env', '.env', './', 'dist/.env.production', 'output/**/*.pem'])('rejects unsafe artifact path %s', (path) => {
    expect(problems(ci.replace('output/test-results/', path))).toContain('artifact path');
  });

  it('accepts multiple scoped artifact paths and matrix subdirectories', () => {
    expect(validateWorkflow(ci.replace('output/test-results/', '"output/playwright/\\ndist/\\noutput/native/\${{ matrix.platform }}/"'), ciPath)).toEqual([]);
  });

  it.each(['true', '${{ github.event_name == \'push\' }}'])('blocks continue-on-error bypass %s', (value) => {
    expect(problems(ci.replace('      - run: npm test', `      - run: npm test\n        continue-on-error: ${value}`))).toContain('continue-on-error');
  });

  it('rejects unbounded CI jobs', () => {
    expect(problems(ci.replace('    timeout-minutes: 15\n', ''))).toContain('timeout-minutes');
    expect(problems(ci.replace('timeout-minutes: 15', 'timeout-minutes: 120'))).toContain('timeout-minutes');
  });

  it('reports a missing runner without throwing on malformed job structure', () => {
    expect(problems(ci.replace('    runs-on: ubuntu-24.04\n', ''))).toContain('runs-on');
  });

  it('requires the merge gate to run after skipped or failed jobs', () => {
    expect(problems(ci.replace('if: always()', 'if: success()'))).toContain('always()');
  });

  it('rejects a merge gate that omits a verification job', () => {
    expect(problems(ci.replace('  gate:\n', '  unchecked:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: npm test\n  gate:\n'))).toContain('every other job');
  });

  it('rejects CI secrets inheritance', () => {
    expect(problems(release.replace('    uses: ./.github/workflows/ci.yml', '    uses: ./.github/workflows/ci.yml\n    secrets: inherit'), '.github/workflows/release.yml')).toContain('secrets: inherit');
  });

  it('requires release workflows to be manual only', () => {
    expect(problems(release.replace('  workflow_dispatch:', '  push:'), '.github/workflows/release.yml')).toContain('workflow_dispatch only');
  });

  it('requires a main-only context gate before release verification', () => {
    const unguarded = release.replace("    if: github.ref == 'refs/heads/main'\n", '').replace('node scripts/ci/release.mjs context', 'echo unchecked');
    expect(problems(unguarded, '.github/workflows/release.yml')).toContain('main');
    expect(problems(release.replace('    needs: context\n', ''), '.github/workflows/release.yml')).toContain('context');
  });

  it('accepts a direct unconditional release-context validator instead of a redundant main condition', () => {
    expect(validateWorkflow(release.replace("    if: github.ref == 'refs/heads/main'\n", ''), '.github/workflows/release.yml')).toEqual([]);
  });

  it('blocks credentials outside a protected environment', () => {
    expect(problems(release.replace('    environment: production\n', ''), '.github/workflows/release.yml')).toContain('environment');
  });

  it('blocks a credential-bearing release job that can bypass CI verification', () => {
    expect(problems(release.replace('    needs: verify\n', '    needs: context\n'), '.github/workflows/release.yml')).toContain('verification');
  });

  it('blocks release credentials after failed verification even when needs is present', () => {
    expect(problems(release.replace('  deploy:\n', '  deploy:\n    if: always()\n'), '.github/workflows/release.yml')).toContain('failed or cancelled');
  });

  it('blocks a context guard that permits branches other than main', () => {
    const unguarded = release.replace('node scripts/ci/release.mjs context', 'echo unchecked').replace("if: github.ref == 'refs/heads/main'", "if: github.ref == 'refs/heads/main' || true");
    expect(problems(unguarded, '.github/workflows/release.yml')).toContain('main-only');
  });

  it('requires every migration to be an executable fixture in the database test', () => {
    const paths = ['supabase/migrations/20260101000000_first.sql', 'supabase/migrations/20260102000000_second.sql'];
    const source = `fixture('${paths[0]}');\n// '${paths[1]}'`;
    expect(validateMigrationCoverage(paths, source)).toEqual([`${paths[1]}: add this migration to scripts/test-bee-db.mjs fixture coverage`]);
    expect(validateMigrationCoverage(paths, `${source}\nfixture("${paths[1]}");`)).toEqual([]);
  });

  it('does not count comments or quoted JavaScript examples as executed migrations', () => {
    const path = 'supabase/migrations/20260101000000_first.sql';
    const source = `// fixture('${path}');\nconst example = "fixture('${path}')";`;
    expect(validateMigrationCoverage([path], source)).toHaveLength(1);
  });

  it('discovers additional workflow and nested composite action files', () => {
    const root = mkdtempSync(join(tmpdir(), 'trackbing-workflow-policy-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    mkdirSync(join(root, '.github/actions/nested'), { recursive: true });
    mkdirSync(join(root, 'supabase/migrations'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), ci);
    writeFileSync(join(root, '.github/workflows/extra.yaml'), release.replace(`on:\n  workflow_dispatch:`, `on:\n  workflow_run:`));
    writeFileSync(join(root, '.github/actions/nested/action.yaml'), composite.replace(`@${pin}`, '@main'));
    writeFileSync(join(root, 'scripts/test-bee-db.mjs'), '');
    expect(inspectRepository(root).join('\n')).toContain('extra.yaml');
    expect(inspectRepository(root).join('\n')).toContain('nested/action.yaml');
  });
});
