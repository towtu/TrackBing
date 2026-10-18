# CI and release guide

Every pull request and push to `main` runs verification. Web/backend releases
and native builds require an operator to start a workflow from `main`. The
workflows are implemented in the repository; GitHub protection rules and
provider configuration still need the setup below. No hosted release, signed
native build, store submission, or production migration is claimed here.

## From a pull request to a release

```text
Pull request → parallel checks → Ready to merge → review and merge to main
Main commit → manual staging release → passing candidate and live checks
Same main commit → manual production release → passing candidate and live checks
```

[CI](../.github/workflows/ci.yml) also runs for merge queues, manual verification,
and a weekly schedule. The release workflows call this same CI workflow at
their dispatched commit, so an earlier green run does not bypass verification.
Actions use immutable commit pins; `.nvmrc` pins Node, and `npm ci` uses the
lockfile. Obsolete CI runs are cancelled. Releases remain serialized and are
never cancelled automatically during a migration.

| Check | What it verifies |
| --- | --- |
| App quality | ESLint, TypeScript, Vitest, workflow policy, and actionlint |
| Backend and database | Deno type checks, real PostgreSQL migration/ownership/confirmation tests, and mocked Edge Function provider tests |
| Dependencies and secrets | Dependency audit policy and tracked secret patterns |
| Web export | Expo static web export with dummy public configuration and exported secret-pattern checks |
| Native export | Android and iOS JavaScript/assets export and secret patterns, including Hermes bundles; no signing or binary build |
| Browser, seven suites | Public web, auth, account, Cookbook, Bee motion, creation, and label-photo flows at 375/768/1440 px against the same web export |
| Ready to merge | Passes only when every required job succeeds, including all browser/native matrix entries |

Browser checks intercept Auth, database, and provider requests. They use marked
test data and make no real account writes or paid AI calls. Database tests use
an isolated Docker PostgreSQL instance and synthetic users; they do not connect
to a hosted Supabase project. Neither replaces a staging test with real Auth,
RLS, provider sandbox configuration, or devices.

CI uploads unit results, audit results, web/native exports, and browser
screenshots/results. Evidence is retained for 7 days; exports for 3 days.
The workflow policy rejects privileged PR triggers, inherited secrets,
unpinned actions, ignored required failures, credential-bearing jobs without
environment/CI gates, and migrations omitted from database-test coverage.

## Configure GitHub before enabling releases

1. In repository **Settings → Actions → General**, enable the repository
   workflows and use read-only default workflow permissions. CI requests
   `contents: read`; releases additionally request `actions: read` to inspect
   staging evidence. Deployment credentials belong to environments.
2. Protect `main` with a ruleset or branch protection: require pull requests,
   review, and the **Ready to merge** status check from CI. Keep force pushes
   and deletion disabled. Run CI once so its check is selectable. If using a
   merge queue, retain the `merge_group` trigger. These repository settings
   are operator setup, not settings applied by this change. See
   [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
3. Create environments named **staging** and **production** in
   **Settings → Environments**. Allow only the `main` branch, configure
   required reviewers, prevent self-review, and disable administrator bypass.
   Environment protection runs before credentials become available. Check
   that the repository's GitHub plan supports required reviewers, especially
   for private repositories. If those rules are unavailable, keep
   `RELEASE_ENABLED` disabled until the required protection is configured. See
   [GitHub environment setup](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
4. Add the repository variables and environment values below. Use separate
   Supabase and Vercel projects for staging and production. The release helper
   rejects missing identities, shared projects, and a selected environment
   pointing to the wrong registered project.

Set these four **repository variables** under
**Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
| --- | --- |
| `STAGING_SUPABASE_PROJECT_REF` | Staging's 20-character Supabase project reference |
| `PRODUCTION_SUPABASE_PROJECT_REF` | Production's distinct Supabase project reference |
| `STAGING_VERCEL_PROJECT_ID` | Staging Vercel project ID |
| `PRODUCTION_VERCEL_PROJECT_ID` | Production's distinct Vercel project ID |

Set these **environment variables separately in staging and production**:

| Variable | Value |
| --- | --- |
| `RELEASE_ENABLED` | `true` only after setup and release review; blank/false blocks deployment/build |
| `SUPABASE_PROJECT_REF` | Selected environment's registered Supabase reference |
| `VERCEL_PROJECT_ID` | Selected environment's registered Vercel project ID |
| `VERCEL_ORG_ID` | Vercel organization/team ID owning that project |
| `EXPO_PUBLIC_SUPABASE_URL` | Exactly `https://<SUPABASE_PROJECT_REF>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | That project's public anon or publishable key; never a service-role/secret key |
| `EXPO_PUBLIC_SITE_ORIGIN` | Real public HTTPS origin, without a path, query, credentials, or custom port |
| `EXPO_PUBLIC_LEGAL_OPERATOR` | Actual responsible operator |
| `EXPO_PUBLIC_PRIVACY_EMAIL` | Actual monitored contact email |
| `EXPO_PUBLIC_LEGAL_REVIEWED` | `true` after reviewing the published policies; required for production |
| `SUPABASE_INCLUDE_ALL_MIGRATIONS` | Leave blank/false normally; use `true` only after reviewing the older-migration case below |

Set these **environment secrets** with credentials scoped to the intended
provider account/project:

| Secret | Used by |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Supabase linking, migration, and function deployment |
| `SUPABASE_DB_PASSWORD` | Selected Supabase database connection |
| `VERCEL_TOKEN` | Pull/build/upload/promote for the selected Vercel project |
| `EXPO_TOKEN` | Native EAS environment pull and build only |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Optional candidate/live smoke access if Vercel Deployment Protection requires it |

No extra GitHub personal access token is needed for evidence lookup; the
workflow uses its read-only `github.token`. Public client values are compiled
into the app. Supabase RLS remains the security boundary for user-owned data.
The release workflow keeps analytics disabled.

## Configure the providers

**Vercel:** Set both projects' build command/output to the checked-in
`vercel.json` (`npm run build:web`, `dist`). Keep
`git.deploymentEnabled=false`, which disables automatic Git deployments.
Remove any separately configured deploy hook or automation that would bypass
this release path. See
[Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration).

The workflow uses Vercel's **Production** environment in each isolated project,
including the staging project. Align each project's Production public values
with its corresponding GitHub environment: the six `EXPO_PUBLIC_*` values
listed above, with analytics disabled. The candidate is rebuilt with real
environment values; the dummy-config PR export is verification evidence.
Configure the intended HTTPS domain and any automation protection bypass
secret before testing the release.

**Supabase:** Keep the existing server-only configuration in each Supabase
project. The release workflow deploys code; it does not provision or overwrite
Gemini, USDA, billing, payment, or store secrets. The safe
[server template](../supabase/functions/.env.example) and
[backend deployment guide](bee-gemini-deployment.md) list the exact names.
Paid AI needs `GEMINI_API_KEY`, model/settings, and the explicit
`GEMINI_PAID_DATA_USE_CONFIRMED` gate. USDA needs `USDA_API_KEY`. Enabled billing
needs the product mapping, relevant PayMongo/Apple/Google credentials,
webhook configuration, and `BILLING_RECONCILE_SECRET`. Keep sandbox and live
settings separate. Configure Auth redirect URLs, recovery email templates,
and SMTP using the [account guide](account-and-diary-ux.md).

Seven functions are deployed: `bee-chat`, `ai-food`, `ai-label`, `usda-search`, `billing`,
`billing-webhook`, and `billing-reconcile`. The CLI uses `--no-verify-jwt`
because these handlers implement their own authentication: user endpoints
verify Supabase sessions; webhooks verify provider signatures; reconciliation
checks its server credential. Retain those checks when changing a handler.
See [Supabase function authentication](https://supabase.com/docs/guides/functions/auth).

**Expo/EAS:** Keep the existing EAS project ID in `app.json`. Configure the
remote **preview** environment to match GitHub **staging**, and remote
**production** to match GitHub **production**, for all six public values in
the table. Use pullable plaintext visibility for these public build values;
they are included in client bundles. Native analytics must remain disabled.
The workflow pulls the selected EAS environment and rejects mismatches before
requesting a paid build. Keep profile environments explicit in `eas.json`;
inherited profiles and inline environment overrides are rejected. See
[EAS environment variables](https://docs.expo.dev/eas/environment-variables/).

## Release web and backend

In **Actions → Release web and backend → Run workflow**, select branch
`main` and environment `staging`. Record the full commit SHA shown on the run.
After context validation and fresh CI, approve the protected environment job.
The job performs these steps in order:

1. Validate the selected projects, public client key/origin, enablement, and
   production legal settings.
2. Pull the selected Vercel project configuration and build the candidate.
   Check web and Vercel static output secret patterns and stamp `/release.json` with the commit.
   A failed frontend build stops before changing the backend.
3. Link the selected Supabase project, print the migration dry run, apply
   migrations, then deploy the seven functions.
4. Upload the prebuilt candidate with `--prod --skip-domain`, keeping live
   domains on the existing deployment. See
   [Vercel staged domain assignment](https://vercel.com/docs/cli/deploy#skip-domain).
5. Smoke-test the candidate's `/`, `/privacy`, `/terms`, security headers,
   commit identity, and real HTTP 404. Check the configured Supabase public key
   and require unauthenticated requests to the four user endpoints to return
   HTTP 401. These probes do not sign in, call a model, or create payments.
6. Promote only a passing candidate, then repeat the smoke checks on the live
   origin. Upload successful candidate/live evidence and record the run summary.

After a successful staging run, test the real staging app with operator-owned
accounts and provider sandboxes. Then dispatch **production** from `main`
at the **same SHA**. If `main` advanced, release its new commit to staging
first. Production checks metadata for a successful `release.yml` staging
run and its unexpired evidence artifact, bound to that SHA and the registered
staging projects. Evidence lasts 14 days; expired or missing evidence blocks
production. Changes to staging project identities also require new evidence.

Before approving a migration job, confirm a recoverable database backup and
review migrations against the real schema/history. The workflow's dry run
prints pending migrations and then applies them automatically; it is not a
second approval pause. Review the intended migration list before dispatch or
environment approval. See [Supabase backups](https://supabase.com/docs/guides/platform/backups).

An existing project may be missing the older idempotent
`20260613000000_legacy_base_schema.sql` in its migration history. Review
`supabase db push --linked --dry-run --include-all` against that project's
schema before setting `SUPABASE_INCLUDE_ALL_MIGRATIONS=true`. This flag applies
all migrations missing from remote history; leave it disabled unless that
complete list is intended. New projects use the normal chain. See
[Supabase migration flags](https://supabase.com/docs/reference/cli/supabase-db-push).

## Build a native binary

In **Actions → Build native app → Run workflow**, choose `main`, a profile,
and `android`, `ios`, or `all`. The workflow validates identity, reruns CI,
waits for protected environment approval, and smoke-tests the selected live
web/backend environment for this exact SHA, client key, and unauthenticated
API denial before setting up authenticated EAS. It checks EAS public
configuration, then runs `eas build --non-interactive --wait --json`.
Successful results must be `FINISHED` and match the requested SHA, profile,
EAS project, app identifier, and platform set. A cancelled or queued build
cannot pass even if the CLI exits successfully. The uploaded report includes
only build ID/platform/status and the SHA/profile; pulled environment values
and raw provider metadata are removed rather than uploaded.

| Profile | GitHub environment | EAS environment | Output |
| --- | --- | --- | --- |
| `preview` | `staging` | `preview` | Internal Android APK; iOS simulator build |
| `production` | `production` | `production` | Android app bundle; configured production iOS build |

Production native builds require successful web/backend staging evidence for
the same SHA. Both profiles also require the same commit to be live in their
selected environment: release web/backend to staging before a preview build,
and to production before a production build. Configure signing credentials in
EAS before a non-interactive build. See
[EAS build setup](https://docs.expo.dev/build/setup/). The current Android
package is `com.kobinggg.TrackBing`.

`app.json` currently has **no `ios.bundleIdentifier`**. iOS or `all` requests
fail before starting a paid build until an approved identifier is added and
aligned with Apple/EAS/store products. Choose Android for the presently
configured identity. CI's successful iOS JavaScript export does not satisfy
that prerequisite or prove an iOS binary can be signed.

Neither release workflow submits to stores, publishes an OTA update, or
automatically runs on a merge. If the 60-minute job expires while EAS still has a queued/running build, inspect
and cancel it in EAS before requesting another; a runner timeout is not a binary
success or guaranteed provider cancellation. Physical-device, accessibility, receipt/restore,
and provider sandbox tests remain required before distributing a new binary.

## Dependency audit policy

`npm run ci:audit` runs `npm audit --json`, reports all severity counts, and
writes `output/ci/audit.json`. Every new high finding and every critical
finding blocks CI. Registry failures, malformed reports, and invalid/expired
exceptions also fail closed.

The checked-in [exception policy](../.github/security-audit-exceptions.json)
acknowledges these four underlying high advisories. Their owner is `towtu`;
all expire at **2026-10-18 00:00 UTC**. Passing this policy is **not a clean
dependency audit**: the findings remain open until a compatible fix is verified.

| Package | Open advisory |
| --- | --- |
| `braces` | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| `image-size` | [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) |
| `image-size` | [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) |
| `node-forge` | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) |

Exceptions match exact package/advisory pairs. Resolve compatible dependency
updates, rerun app/backend/browser/native-export checks, and remove resolved
entries. Inherited vulnerable package counts can exceed four. Expired entries
fail even if the dependency disappeared; keep the policy current.

## Reproduce verification locally

Use the Node version in `.nvmrc`, Docker for PostgreSQL tests, and the pinned
Deno version from CI. Workflow lint downloads a checksum-verified actionlint
binary and currently requires Linux x64; ShellCheck adds shell validation when
installed. Run these commands without deployment credentials:

```sh
npm ci --no-audit
npm run lint
npm run typecheck
npm test
npm run ci:policy
npm run ci:lint
npm run ci:audit
npm run typecheck:functions
deno check --config supabase/functions/deno.json supabase/tests/usda_proxy_deno.mts supabase/tests/billing_deno.mts
npm run test:db
```

Build and test the same controlled web export:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://ci-fixture.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=build-only-placeholder npm run build:web
node scripts/check-secrets.mjs --dist
npx playwright install --with-deps chromium
npm run ci:browser -- --all
```

`ci:browser` also accepts `web`, `auth`, `account`, `cookbook`, `motion`, or
`creation`, or multiple suite names. It serves `dist` on an ephemeral localhost
port, uses bundled Chromium by default, and bounds each suite to 180 seconds.
`CHROME_BIN` can override it with an executable path. Missing exports/browsers,
invalid suites, test failures, cancellation, and timeouts fail the command.
Auth/Cookbook request waits and the motion sheet handoff now synchronize on
actual fixture/UI readiness rather than treating a loading label as proof the
request handler or dashboard mascot is ready.
Screenshots/results are under `output/playwright/`.

The secret scanner also accepts `--export-dir <relative directory>`, including
Hermes `.hbc` output. It rejects inaccessible exports and symlink escapes, prints
no credential values, and checks known key formats and privileged Supabase JWTs.
It is a pattern scan, not a complete credential/history audit.

Native export equivalents, using the same dummy public values:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://ci-fixture.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=build-only-placeholder npx expo export --platform android --output-dir output/native/android
EXPO_PUBLIC_SUPABASE_URL=https://ci-fixture.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=build-only-placeholder npx expo export --platform ios --output-dir output/native/ios
node scripts/check-secrets.mjs --export-dir output/native/android --export-dir output/native/ios
```

### Local verification record

Verified locally on 4 October 2026 with Node 24.21.0. A local pass
does not establish that GitHub workflows, environment protection, Vercel,
Supabase deployment, or EAS credentials have been exercised.

| Verification | Final local result |
| --- | --- |
| ESLint / TypeScript | Passed, including targeted CI scripts |
| Vitest | 866 tests across 56 files passed; JUnit at `output/test-results/vitest.xml` |
| Workflow policy / actionlint | Passed for all three workflows, composite setup, and 15 migration fixtures |
| Dependency audit | 0 critical, 27 high, 12 moderate affected packages; policy passes with four temporary high advisory exceptions, findings remain open |
| Deno checks / real PostgreSQL tests | All six functions and test imports typechecked; migration/RLS/concurrency invariants passed in disposable PostgreSQL 16; 17 Deno handler tests passed |
| Dummy-config web export / secret checks | Passed, 23 static routes; tracked, web and both native exports scanned |
| Six mocked Chromium browser suites | All six passed at 375/768/1440 px using bundled Chromium; zero unexpected console errors or failed requests |
| Android / iOS JavaScript exports | Both passed: Android Hermes 7.04 MB, iOS 7.05 MB |
| Hosted release / signed native binary | Not executed locally |

## Recover a failed release

A candidate failure prevents promotion; backend migrations/functions may
already have changed. A live smoke failure happens after promotion and needs
operator recovery. Read the failed step and provider logs, retain its commit
and deployment URL, and reconcile any partially completed backend changes
before retrying.

Prefer a reviewed forward fix for database/functions. Keep migrations additive
and compatible with the still-live client. Do not reset a linked database,
drop private tracking tables, or roll back users' diaries to undo a frontend
release. A database restore needs an approved backup/recovery procedure and
accounts for data written since the backup.

For a frontend regression, an operator may restore the previous known-good
Vercel deployment after verifying compatibility with the current backend.
Record that deployment/SHA and rerun the public smoke checks for the restored
SHA. Promotion alone does not reverse migrations or functions. Disable paid
AI or checkout using existing server gates if needed while preserving manual
tracking, then stage and verify the forward fix. This workflow does not
automatically roll back a release.
