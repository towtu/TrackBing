# Release hardening and repository cleanup

**Goal:** Correct confirmation recovery, remove genuinely unused
dependencies, and make the repository easier to navigate without losing user
work or release evidence. Existing Expo/Supabase architecture stays in place.

## Confirmed work and checks

- [x] Verify and link the existing Vercel project; align future build settings
  and register public production mappings. Keep both release flags false.
  Applied setup: `docs/launch/2026-10-19-release-connection.md`.
- [x] Reproduce the timezone-dependent retry conflict in
  `supabase/functions/_shared/beeService.test.ts`: same confirmed command/key,
  changed saved timezone, expected original success, observed conflict.
- [x] In `beeService.ts`, fingerprint the validated original request before
  applying the authoritative saved timezone to a new turn. The regression now
  passes; changed commands still conflict and new diary reads use saved dates.
- [x] Remove unused `nativewind` and `tailwindcss` dependencies and their
  Tailwind-only selector override/test. Regenerate and clean-install the
  lockfile. Keep both expired exceptions unchanged: a full reverse dependency
  check also found `braces` through Metro and React Native/Jest. Removing unused
  styling reduces the dependency graph but does not remediate that advisory.
- [x] Group domain types under `src/types/index.ts`, remove only unreferenced
  starter artwork, clear confirmed empty directories and disposable download/
  registry caches, and move old CLI screenshots into existing ignored output.
  Keep app routes, migrations, provider configuration, user patches, branded
  assets, pinned runtime tools, current verification artifacts and git bundle.
- [x] Add a concise `docs/README.md` navigation guide and update README links
  to active DeepSeek/setup evidence. Retain historical specs with clear labels.
- [x] Run application typecheck/lint/full tests, seven Edge Function checks,
  isolated PostgreSQL tests, web and both native exports, all seven browser
  suites at 375/768/1440, workflow policy/lint and secret-pattern scans. Record
  the remaining security gate failure accurately; do not renew exceptions.
- [x] Review the focused diff, update current launch evidence, commit as
  `towtu <fatowtu123@gmail.com>`, and push to existing draft PR11. Do not merge,
  deploy, modify real user rows or call paid providers.

Audit diagnostics also preserve validated blocker IDs on invalid/expired policy;
two regressions failed before the change and now pass. The gate remains closed.

## Additional investigation

A source-map profile recorded a 2,893,558-byte web entry, including 710 KB of
Reanimated source through the dashboard progress ring. Profile evidence is in
ignored `output/release/profile-web/`. Performance changes require their own
measured benefit and browser/native verification; the mobile speed target is
still open. Do not enable experimental SDK 58 optimizations on SDK 54 blindly.

### Measured web progress boundary

- [x] Reproduce the missing accessible calorie progressbar in the existing
  browser suite before changing the renderer.
- [x] Extract `src/components/nutrition/CalorieProgress.tsx` for the existing
  native renderer, with a `.web.tsx` SVG implementation matching its 130px
  surface, 148-unit viewBox, 69.5-unit radius and 9-unit stroke. Keep actual intake
  in accessible text when the web arc fills at its target.
- [x] Add 8 actual rendered-markup tests for empty/fractional/over-target and
  invalid data; guards must prevent invalid SVG/ARIA numeric values.
- [x] Confirm the new source-map export omits Reanimated/Redash/Worklets and
  measure actual raw/gzip entry bytes rather than predicting from source size.
- [x] Export/finalize the current web build, run all browser suites and both
  native exports, inspect screenshots and compare serial Lighthouse baselines.
- [x] Record the measured benefit, remaining performance target and rollback;
  review and commit the small platform boundary without adding dependencies.

### Historical credential review

- [x] Checksum-verify official Gitleaks 8.30.1 and scan all 266 locally reachable
  commits with redaction. Triaged three findings and retained safe metadata
  only. The historical USDA literal has no current tracked/web matches, but
  requires revocation/replacement; no provider call tested its validity.
- [x] Independently review and commit the recovery guide and qualified launch
  evidence. No credential values were emitted, no history was rewritten and
  no production secret was changed. Recovery remains an operator task.

## Recovery

Revert a focused code/dependency commit and run `npm ci` if needed; that restores
the earlier dependency risk. No new migration is required for these changes.
Deleted tracked template files remain recoverable from Git. Keep setup flags
false while correcting configuration and retain all customer data.
