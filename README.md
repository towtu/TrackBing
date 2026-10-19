# TrackBing

Food, calorie, macro and weight tracking for web, iOS and Android, built with
Expo, React Native, TypeScript and Supabase.

## Start here

- [Documentation index](docs/README.md): current guides and repository map.
- [DeepSeek Bee and label photos](docs/deepseek-label-photos.md): server setup,
  reviewed food/weight/goal actions, limits and deployment order.
- [Private Bee preview](docs/launch/2026-10-19-private-bee.md): applied backend
  migrations, restricted test access, localhost checks and recovery.
- [Release readiness](docs/launch/2026-10-18-release-readiness.md) and
  [hosting connection](docs/launch/2026-10-19-release-connection.md): verified
  code versus outstanding production setup.
- [CI and releases](docs/CI_CD.md): checks, protected environments and recovery.

The active implementation is in draft PRs
[#10](https://github.com/towtu/TrackBing/pull/10) and
[#11](https://github.com/towtu/TrackBing/pull/11). The new Bee/label backend is
deployed for a restricted private evaluation; public web/native changes are not
released. The security audit still blocks public release, and automated release
flags remain disabled.

## Main features

- Daily food diary, calorie/macro totals, barcode lookup and manual entry.
- Filipino food lookup through the operator's gist, private foods and recipes,
  Open Food Facts, and USDA where matching evidence is available.
- Bee conversation, user-controlled preferences, source-backed food reviews,
  weight check-ins and separate goal reviews. A later explicit confirmation
  saves the exact server-owned proposal once.
- Optional DeepSeek search answers and nutrition-label photo transcription.
  Search-only answers cannot become verified food entries; users review label
  values and portions before a separate Add action.
- Profile targets, dated weight history, password recovery, diary export and
  consent-controlled optional web analytics.

Provider credentials, legal approval, live payment/store configuration and
physical-device verification remain setup requirements. See the guides above
for actual implementation and verification boundaries.

## Local development

Use Node 24.21.0 from `.nvmrc`:

```sh
npm ci
test -e .env.local || cp .env.example .env.local
```

Fill only the public Supabase URL and anon/publishable key in `.env.local`.
Configure the other public values when needed. Server/provider/service-role
secrets belong in Supabase; never put them in `EXPO_PUBLIC_*` variables.

```sh
npm start
# Press w for web, or open the Expo development client on a device.
npm run typecheck
npm test
npm run lint
npm run build:web
```

For a local web preview, run `node scripts/serve-web-export.cjs` after the build,
then open `http://localhost:8091`. The build clears Metro's cache so a previous
mocked CI export cannot leave test authentication settings in the preview.
CI fixture exports are for automated tests and cannot sign in to real accounts.

Backend checks, isolated database tests, browser checks and native build setup
are documented in [CI and releases](docs/CI_CD.md). Apply the complete reviewed
migration chain and deploy functions before publishing a client that uses them.
Do not apply only an old individual migration from a historical design.

## Repository

```text
app/          Expo Router routes and layouts
src/          Components, screens, domain types, state and app utilities
supabase/     Edge Functions, additive migrations, email templates and SQL tests
assets/       TrackBing branding, Bee poses and native splash artwork
public/       Public web assets
scripts/      Build, security, database and controlled browser checks
vendor/       Reviewed dependency compatibility source and license
.github/      CI, release workflows and security policy
docs/        Setup, feature guides, launch evidence and historical designs
```

Generated output stays ignored. The editor hides build/dependency folders;
[project structure and cleanup](docs/project-structure.md) explains what belongs
where and how to regenerate local artifacts.

The original [Gemini implementation brief](TrackBing_Gemini_Search_Migration_README.md)
is retained as historical product context. The current DeepSeek guide supersedes
its provider setup; do not use historical pricing as a current guarantee.
