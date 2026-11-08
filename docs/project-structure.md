# Project structure

The code uses Expo Router's existing layout. Routes stay under `app/`; shared
implementation stays under `src/`. This avoids breaking native/web routing or
creating a second application structure.

| Folder | Purpose |
| --- | --- |
| `app/` | Route entry points, authentication, legal pages and tab layouts |
| `src/screens/` | Main screen implementations reused by route entry points |
| `src/components/` | Shared UI; feature groups such as `ai`, `auth`, `scan` and `legal` |
| `src/lib/` | App services, domain rules and colocated unit tests |
| `src/types/` | Shared domain types in `index.ts` and library declarations |
| `src/styles/` | TrackBing colors, styles and contrast tests |
| `src/hooks/`, `src/constants/` | Shared hooks and named constants |
| `supabase/functions/` | Authenticated server handlers and validated shared logic |
| `supabase/migrations/` | Ordered additive schema history; do not delete old migrations |
| `supabase/tests/` | Disposable-database and Edge Function checks |
| `supabase/templates/` | Authentication email templates |
| `assets/images/` | App branding, splash and eight approved Bee poses |
| `public/` | Static web assets |
| `scripts/` | Export, scanner, database and browser verification tools |
| `scripts/ci/`, `scripts/fixtures/` | Release guards/tests and controlled test data |
| `vendor/` | Reviewed dependency compatibility source, archive and attribution |
| `docs/` | Current guides; start at the [documentation index](README.md) |
| `.github/` | Workflows, reusable CI steps, ownership and security policy |

## Generated and local folders

These are ignored and hidden in the project editor's Explorer, not source code:

| Folder | How it is used or regenerated |
| --- | --- |
| `node_modules/` | `npm ci`; matches the reviewed lockfile |
| `dist/` | `npm run build:web`; required before local browser checks |
| `.expo/` | Local Expo cache and generated route types; Expo regenerates it |
| `.vercel/` | Local link/build metadata; link the intended existing project |
| `output/` | Verification evidence, screenshots, local tools and git bundle |

Keep `.env.local`, `.claude/settings.local.json`, `.vscode/` and any user patch
private/as appropriate. A folder is not unnecessary merely because it is hidden.
Editor preferences were merged into `.vscode/settings.json`; existing save
actions were preserved.

## Cleanup applied on 19 October 2026

- Consolidated shared domain types from `src/types.ts` into the existing
  `src/types/index.ts`. Existing `@/src/types` imports keep the same public path.
- Removed unused NativeWind/Tailwind dependencies and their Tailwind-only
  selector override/compatibility test. The regenerated lockfile removes 51
  packages, adds none and changes no unrelated package version. The app already
  uses React Native `StyleSheet`; no styling system was replaced.
- Removed five unused Expo starter images: default icon/favicon and the three
  default Android icon layers. Metro/smoke fixtures now use the real TrackBing
  icon. Configured native icon, splash, brand logos, social preview and Bee art
  were retained.
- Removed confirmed empty `.agents/`, `.codex/`, `.worktrees/` and `tmp/`.
  Git reported only this checkout, with no linked worktree to remove.
- Moved old `.playwright-cli/` artifacts into
  `output/playwright/legacy-cli/`, preserving screenshots/logs.
- Grouped six previous design/build/native/review artifact directories under
  `output/archive/2026-10-19/`. Current `release`, `ci`, `playwright`, installed
  tools and the git bundle retain their paths; `output/README.md` maps them.
- Deleted disposable npm registry caches and already-extracted tool download
  archives: 202,425,997 bytes reclaimed. Installed pinned tools, current test
  evidence, schema rehearsal files and the reviewable git bundle were retained.
- Preserved the user's unrelated `codex.diff` and original `.env.local` byte
  for byte. Cleanup evidence is in ignored `output/release/setup/cleanup.json`.

Unused styling removal does **not** resolve the remaining `braces` advisory:
Metro and React Native/Jest still depend on it. Both existing expired security
exceptions remain unchanged. See [dependency findings](dependency-remediation.md).

Tracked deleted assets can be recovered from this cleanup commit's parent in
Git. Empty/cache folders regenerate when their tools need them. Recover an old
artifact from the retained output location; no database rollback or user-data
deletion is part of this cleanup.
