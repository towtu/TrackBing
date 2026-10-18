# Dependency and hosted CI remediation — 18 October 2026

This is a reviewable code change, not a production release. Expo SDK 54,
React Native 0.81.5, existing food data and database migrations remain unchanged.
The dependency gate remains blocked by unresolved high-severity advisories.

## Compatible patches

| Dependency | Change and reason | Evidence |
| --- | --- | --- |
| Metro family | Override the 14 packages pinned by `@expo/metro` together from 0.83.3 to 0.83.8, keeping one coherent patch version. The upstream patch removes `image-size` and uses its maintained image parsers. | [Metro release](https://github.com/react/metro/releases/tag/v0.83.8); `npm ls image-size --all` finds no installed package. Fixes [JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) advisories. |
| `source-map-js` | 1.2.1 → 1.2.2; reject invalid indexed-map offsets. | [Advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| `postcss-selector-parser` | 6.1.4 → 7.1.6; removes quadratic flat-selector parsing. The major-version override is covered by actual Tailwind variants, `@apply` and nested-selector processing. | [Advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |
| Xcode's `uuid` | Scoped override 7.0.3 → 11.1.1, retaining CommonJS and the `v4()` API used by Xcode. Reject undersized destination buffers. | [Advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |

No new direct dependency or framework upgrade was introduced. Related Metro
parser/runtime packages change together in the lockfile. A direct `image-size`
2.x override was rejected because it removes the synchronous filename API
used by the old Metro implementation.

The six tests in `scripts/ci/dependency-compatibility.test.ts` exercise the actual
installed dependency APIs. Before patching, the malformed ICNS test terminated
the isolated child parser, UUID accepted an undersized buffer, and source-map
accepted an infinite offset. After patching, all six pass. The child parser
has a bounded heap and timeout; the malformed bytes are synthetic test data.
Valid artwork is checked through both Metro asset APIs.

## Remaining findings — release blockers

| Dependency | Severity / status | Required remediation |
| --- | --- | --- |
| `braces` 3.0.3 | High; [no published patch](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) at inspection. Used in build/watch glob processing. | Adopt a verified upstream fix or an independently reviewed compatible replacement, then rerun the full checks. Do not feed untrusted glob patterns into build tooling. |
| `node-forge` 1.4.0 | High; [no published patch](https://github.com/advisories/GHSA-86w9-cpqp-85rv) at inspection. Present through Expo CLI/code-signing tools. | Adopt a verified fix and verify signing/certificate behavior. A JavaScript export does not establish native signing security. |
| `decode-uri-component` 0.2.2 | Moderate; [patched in 0.5.0](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), but that release is ESM while the current router's `query-string` expects a callable CommonJS export. | Integrate a compatible router/query-string patch or a reviewed decoder backport; test malformed URL inputs on web and native. A blind override breaks navigation. |
| `sprintf-js` 1.0.3 | Moderate; [no published patch](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). In the inherited Babel/Jest/argparse tooling chain. | Adopt an upstream patch or compatible removal; do not accept externally supplied format strings in tooling. |

Reachability notes narrow the exposure; they do not close an advisory.
The expired `braces` and `node-forge` exceptions were preserved without renewal,
so `ci:audit` fails closed. The two resolved image-parser exceptions were removed.
All four underlying advisories remain visible in the raw audit; affected-parent
counts may differ with npm's cached meta-vulnerability calculations. Count the
underlying advisories when comparing remediation, and retain complete reports.

## Hosted CI fixes

The first PR #11 run, `39109003823`, passed frontend tests, database checks,
both native exports, the web export and six browser suites. It failed:

- Workflow lint: hosted ShellCheck interpreted literal backticks in a quoted
  `printf` format as suspicious. Escaping those literals preserves the exact
  release-summary output and passes actionlint with ShellCheck enabled.
- Web browser suite: CI has no physical camera. The suite now explicitly uses
  Chromium's synthetic camera and asserts a live video track. It no longer
  silently permits camera permission errors. Real camera/device verification
  remains separate.
- Dependency audit: unresolved advisories and expired exceptions still block
  the gate. This change does not suppress errors or relax severity policy.

## Verification and recovery

Run with Node 24.21.0 from `.nvmrc`:

```sh
npm ci --no-audit
npm run typecheck
npm run lint
npm test
npm run ci:policy
npm run ci:lint # include ShellCheck on PATH
npm run ci:audit # expected failure until open high findings are remediated
npm run build:web
npm run ci:browser -- --all
```

Local verification after the patches:

| Check | Result |
| --- | --- |
| TypeScript / ESLint | Passed on Node 24.21.0 |
| Vitest | 910 tests across 61 files passed, including six dependency API/security regression tests |
| Web export | Passed; 23 static routes and export finalizer checks |
| Native JavaScript exports | Android 7.08 MB and iOS 7.09 MB Hermes bundles passed; not signed/device builds |
| Workflow policy / actionlint | Passed; actionlint includes ShellCheck 0.11.0 |
| Secret-pattern scan | 441 tracked/export files checked; no findings; excludes Git history and unknown credential formats |
| Dependency audit | Still blocked: two high and two moderate underlying advisories remain; no exception renewal |

Backend/real PostgreSQL tests and all seven browser suites are also required
by CI. Provider calls and browser account data are mocked; no live account
history or paid API request is changed. Results and the final hosted-run URL
are recorded in the PR. See [current provider setup](deepseek-label-photos.md)
for live setup.

Rollback a reviewed patch commit on the feature branch and run `npm ci` to
restore the matching lockfile. No database rollback or data deletion is needed.
Do not promote a rollback as secure: it restores the earlier vulnerabilities.
