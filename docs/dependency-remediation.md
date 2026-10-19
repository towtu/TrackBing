# Dependency and hosted CI remediation — 18 October 2026

This is a reviewable code change, not a production release. Expo SDK 54,
React Native 0.81.5, existing food data and database migrations remain unchanged.
The dependency gate remains blocked by unresolved high-severity advisories.

## 19 October cleanup and diagnostics

Removed unused `nativewind`/`tailwindcss`, their selector-parser override and
the obsolete Tailwind-only compatibility test. Tracked application source uses
React Native `StyleSheet`; there are no NativeWind imports, class-name styling
or Tailwind/Metro/Babel integration. The clean lockfile removes 51 packages,
adds none and changes no unrelated version. Remaining Metro asset tests now use
the actual TrackBing icon after unused starter artwork was removed.

This is dependency cleanup, **not remediation of `braces`**. A direct reverse
lockfile/source check found retained consumers through
`expo → @expo/metro → metro-file-map → micromatch → braces` and React Native's
Jest dependencies. The initial Tailwind-only hypothesis was rejected. Both
expired exceptions remain unchanged; the current audit still blocks both root
advisories, with 21 affected high packages and zero critical/moderate findings.

The audit report now preserves fully validated blocker identifiers before
checking exception policy. Invalid/expired policy still produces `status:error`,
zero acknowledgements and exit 1; high/critical findings default to blocked.
Registry descriptions remain omitted. Two failing-then-passing regressions and
an independent mixed-policy review verify this behavior without renewing an
exception. The compatible-patch record below describes the 18 October work;
the Tailwind selector override/test is now retired because its consumers are gone.

## Compatible patches

| Dependency | Change and reason | Evidence |
| --- | --- | --- |
| Metro family | Override the 14 packages pinned by `@expo/metro` together from 0.83.3 to 0.83.8, keeping one coherent patch version. The upstream patch removes `image-size` and uses its maintained image parsers. | [Metro release](https://github.com/react/metro/releases/tag/v0.83.8); `npm ls image-size --all` finds no installed package. Fixes [JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) advisories. |
| `source-map-js` | 1.2.1 → 1.2.2; reject invalid indexed-map offsets. | [Advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| `postcss-selector-parser` | 6.1.4 → 7.1.6; removes quadratic flat-selector parsing. The major-version override is covered by actual Tailwind variants, `@apply` and nested-selector processing. | [Advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) |
| Xcode's `uuid` | Scoped override 7.0.3 → 11.1.1, retaining CommonJS and the `v4()` API used by Xcode. Reject undersized destination buffers. | [Advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) |
| Router's `decode-uri-component` | Local compatibility copy of patched upstream 0.5.0; only its export changes to a callable CommonJS function. Preserves query-string 7 / Expo Router 6. | [Source, integrity and license](../vendor/decode-uri-component/UPSTREAM.md); [advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) |
| Coverage loader's YAML parser | Scoped override of `@istanbuljs/load-nyc-config` to the already-installed `js-yaml` 4.3.2. Removes YAML 3, argparse 1 and `sprintf-js` entirely. | Actual inherited YAML configuration and forbidden-JavaScript-tag tests; [formatter advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) |

No framework upgrade was introduced. The follow-up adds one small, local,
MIT-licensed decoder dependency, with no new external package or installation
script. Its 4.3 KB local archive installs as a normal package so npm's registry
advisory scan includes it; linked local packages would be skipped. Tests compare
the installed files with the reviewed source and reject a link or any install
script. Related Metro parser/runtime packages change together in the lockfile. A direct `image-size`
2.x override was rejected because it removes the synchronous filename API
used by the old Metro implementation.

The six tests in `scripts/ci/dependency-compatibility.test.ts` exercise the actual
installed dependency APIs. Before patching, the malformed ICNS test terminated
the isolated child parser, UUID accepted an undersized buffer, and source-map
accepted an infinite offset. After patching, all six pass. The child parser
has a bounded heap and timeout; the malformed bytes are synthetic test data.
Valid artwork is checked through both Metro asset APIs.

The follow-up's twelve tests in `scripts/ci/router-dependencies.test.ts` cover
upstream source/license integrity, the installed CommonJS router consumer,
Unicode food names, barcodes, repeated query values, recovery redirect values,
malformed UTF-8 and inherited YAML configuration. Before patching, the malformed
query exhausted the bounded child process and YAML accepted a JavaScript tag.
After patching, both regressions pass. The decoder source hash test reverses the
single export substitution and compares the result with the verified upstream
archive; its package version alone is not treated as evidence of a fix.
Expo Router currently uses `URL.searchParams` for inbound parsing; the malformed
query test proves the installed dependency API, not a reproduced app navigation
hang. Existing browser review links verify normal application navigation.

## Remaining findings — release blockers

| Dependency | Severity / status | Required remediation |
| --- | --- | --- |
| `braces` 3.0.3 | High; [no published patch](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) at inspection. Used in build/watch glob processing. | Adopt a verified upstream fix or an independently reviewed compatible replacement, then rerun the full checks. Do not feed untrusted glob patterns into build tooling. |
| `node-forge` 1.4.0 | High; [no published patch](https://github.com/advisories/GHSA-86w9-cpqp-85rv) at inspection. Present through Expo CLI/code-signing tools. | Adopt a verified fix and verify signing/certificate behavior. A JavaScript export does not establish native signing security. |

Reachability notes narrow the exposure; they do not close an advisory.
The expired `braces` and `node-forge` exceptions were preserved without renewal,
so `ci:audit` fails closed. The two resolved image-parser exceptions were removed.
Both remaining underlying advisories are high severity. There are no remaining
moderate findings in the follow-up audit. Affected-parent
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

The follow-up hosted recipe suite sampled the first modal frame before the
focused-screen effect hid the floating launcher. It now waits for the launcher
to become hidden and retains the strict absence assertion. The recipe review,
separate library/diary writes and all three widths remain checked; no extra
fixed sleep or application behavior change was introduced.

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
| Vitest | 922 tests across 62 files passed, including eighteen dependency API/security regression tests |
| Web export | Passed; 23 static routes and export finalizer checks |
| Native JavaScript exports | Android 7.08 MB and iOS 7.09 MB Hermes bundles passed; not signed/device builds |
| Workflow policy / actionlint | Passed; actionlint includes ShellCheck 0.11.0 |
| Secret-pattern scan | 447 tracked/export files checked; no findings; excludes Git history and unknown credential formats |
| Clean installation | `npm ci --no-audit` passed on Node 24.21.0; the router resolves the local patched decoder and no `sprintf-js` remains installed |
| Dependency audit | Still blocked: two high underlying advisories remain; zero critical/moderate findings and no exception renewal |

Backend/real PostgreSQL tests and all seven browser suites are also required
by CI. Provider calls and browser account data are mocked; no live account
history or paid API request is changed. Results and the final hosted-run URL
are recorded in the PR. See [current provider setup](deepseek-label-photos.md)
for live setup.

Rollback a reviewed patch commit on the feature branch and run `npm ci` to
restore the matching lockfile. No database rollback or data deletion is needed.
Do not promote a rollback as secure: it restores the earlier vulnerabilities.
