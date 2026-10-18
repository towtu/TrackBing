# Release hardening and repository cleanup

**Goal:** Correct confirmation recovery, remove genuinely unused vulnerable
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
- [ ] Review the focused diff, update current launch evidence, commit as
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

## Recovery

Revert a focused code/dependency commit and run `npm ci` if needed; that restores
the earlier dependency risk. No new migration is required for these changes.
Deleted tracked template files remain recoverable from Git. Keep setup flags
false while correcting configuration and retain all customer data.
