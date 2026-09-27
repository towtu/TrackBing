# Bee chat with Gemini: implementation and deployment

## Result and responsibilities

The feature preserves Expo/React Native, Supabase Auth, the Bee design tokens,
manual/barcode food entry, `food_logs`, and existing entitlements. The intended
model is `gemini-3.5-flash-lite`; no model is silently substituted.

- `bee-chat` validates the JWT and request, assembles relevant context, dispatches
  validated intents, retrieves owned food history, and manages server-owned reviews.
- Gemini interprets text with a separate no-search JSON call. It cannot return a
  SQL statement, nutrition value, memory write, or confirmation action.
- Independent retrieval reads the owner's personal foods, USDA FoodData Central,
  then Open Food Facts. It preserves preparation, product identity, package size,
  nutrient basis, record ID, original evidence, attribution, and retrieval time.
- Application code scales the retained basis, converts ounces with
  `28.349523125 g/oz` and energy with `4.184 kJ/kcal`, and rounds calories to an
  integer and macros to one decimal. Missing macros remain unknown: the existing
  non-null log schema requires complete values before proposing a log.
- A miss, or an explicit web request, enables Google Search in one separate
  Interactions request. The resulting answer, citations, and intact Search
  Suggestions are **transient display only**. They never become a food draft,
  log, cache, transcript/context, or request replay. On reload, a generic reminder
  replaces that answer. Search again to refresh it.
- PostgreSQL owns thread versions, turn leases, explicit preferences, reviewed
  food snapshots, expiry, shared quota reservations, and atomic confirmation.
  Dashboard refresh uses the existing food-log event and transactional summary RPC.

The Google boundary is deliberately stricter than the permitted private text
history exception. No shared nutrition cache, embeddings, transcript-derived
memory summary, automatic estimate, page crawling, or label-image/OCR feature
was added. Google links are never used as a scraping lead list.

Official references checked during implementation:
[models](https://ai.google.dev/gemini-api/docs/models),
[Interactions API](https://ai.google.dev/api/interactions-api),
[grounding](https://ai.google.dev/gemini-api/docs/google-search),
[Additional Terms](https://ai.google.dev/gemini-api/terms),
[USDA API and CC0](https://fdc.nal.usda.gov/api-guide/), and
[Open Food Facts API/licensing](https://openfoodfacts.github.io/openfoodfacts-server/api/).
Recheck availability, billing and display requirements before production release.

## Files and database entities

| Area | Files / responsibility |
| --- | --- |
| Server contracts and controller | `_shared/beeTypes`, `beeIntent`, `beeConversation`, `beeDates`, `beeRequest`, `beeService`, `beeStore` |
| Providers and food sources | `_shared/beeProviders`, `beeGrounding`, `beeNutrition`; deterministic fixtures beside each module |
| Endpoints | `bee-chat/index.ts`, migrated `ai-food/index.ts`, hardened `usda-search/index.ts`, compatible `_shared/beeLegacyFood` |
| Shared client and account guards | `src/lib/beeChat`, `aiFood`, `aiFoodUi`, `foodAccountGuard`; corresponding tests |
| Bee UI | `BeeQuickLog`, `BeeMemories`, `BeeGroundedAnswer` and platform suggestions/dialog components |
| Existing app integration | `app/_layout.tsx`, Add/Create food screens, `AiFoodSheet`, `dailySummary`, Dashboard local-day bounds |
| Database / verification | `20260915000000_bee_conversations.sql`, `supabase/tests`, `scripts/test-bee-db.mjs`, functions `deno.json`/lock, CI |

All paths in the server rows are under `supabase/functions`. New tables are
`bee_threads`, `bee_messages`, `bee_memories`, `bee_pending_actions`, `bee_turns`,
`ai_lookup_reservations`, and `ai_search_reservations`. `food_logs` gains nullable
`bee_action_id` and `bee_provenance`, plus a unique action constraint and owner/date
index. Existing logs and IDs remain intact. Provenance is the historical reviewed
snapshot; later owner diary edits do not constitute newly verified source values.

Every new table has owner-only SELECT RLS. Writes go through owner-scoped,
service-only RPCs; direct authenticated writes and draft-construction RPC calls
are denied. The sole new client mutation RPC, `refresh_daily_summary`, derives
its owner from `auth.uid()` and accepts only date/timezone. Confirmation locks
state, validates owner/current version/status/expiry/timezone, inserts once, and
recovers the original success after a lost response. Its database write succeeds
before Bee says “Added.” Summary failure returns a separate warning and retains
the saved food.

## Configuration and ordered rollout

Server-only secrets:

```text
GEMINI_API_KEY=<paid Gemini project key>
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_SEARCH_ENABLED=true
USDA_API_KEY=<FoodData Central key>
```

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` to hosted functions. Never use an `EXPO_PUBLIC_*`
variable for server secrets. The app still uses only its existing public Supabase
URL/anon key. USDA is optional for live answer-only search, but needed for reliable
common-food database reviews when no suitable owned/OFF record exists. Open Food
Facts requires no key; its attribution/ODbL metadata is retained. This feature
creates no public combined food database. Review ODbL obligations separately if
adding one later.

1. Back up and inspect the **staging** schema/migration history. The repository
   has no migrations creating its original base tables. The isolated SQL fixture
   is test-only; do not apply it to a real Supabase project.
2. Apply existing migrations in chronological order if not already recorded:
   `20260614000000`, `20260624000000`, `20260624000100`, `20260629000000`,
   `20260629000100`, `20260731000000`; then apply
   `20260915000000_bee_conversations.sql`. Do not mark unapplied migrations as
   applied to bypass schema errors.
3. Configure secrets, deploy `bee-chat`, migrated `ai-food`, and `usda-search`.
   Keep platform JWT verification enabled; each function also validates the JWT
   through `auth.getUser()`. Verify with a staging account.
4. Confirm the hourly `trackbing-bee-history-retention` Cron job exists. When
   `pg_cron` is unavailable, schedule server-only `bee_prune_all_history()` hourly
   with the platform's trusted scheduler.
5. Publish the app only after all migrations/RPCs/endpoints exist. Start with a
   small cohort, provider spend alerts, and numeric latency/error/usage monitoring.
6. Remove DeepSeek/Tavily secrets only after all deployed/older clients and
   branch-specific functions have migrated. Neither new AI endpoint uses them.

Safe command templates (replace only the staging placeholders):

```sh
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase secrets set --project-ref <STAGING_PROJECT_REF> --env-file supabase/functions/.env
npx supabase functions deploy bee-chat --project-ref <STAGING_PROJECT_REF>
npx supabase functions deploy ai-food --project-ref <STAGING_PROJECT_REF>
npx supabase functions deploy usda-search --project-ref <STAGING_PROJECT_REF>
```

Create the ignored `supabase/functions/.env` locally; never commit credentials.
No migration, function, or app was deployed to production during implementation.

## Cost, context, and retention policy

- Existing caps remain **7 free successful lookups per UTC month**, **100 Pro per
  UTC day**, and **15 paid lookup attempts per UTC minute**. Both AI endpoints use
  the same atomic reservations. Failures/clarifications refund monthly/daily
  credits; attempts remain counted. A successful independent review or valid live
  answer consumes one credit, irrespective of internal provider calls.
- Deterministic Add/Cancel, portion corrections from retained evidence, greetings,
  owned history, and preference operations make no paid model/search request.
- Additional Google Search **launch** caps are 3/day free and 20/day Pro, UTC.
  Launched searches are not refunded. A consumed request ID cannot launch Search
  again, even after a failed response. Start a new request to search again.
- One Interactions Search call can execute several billable Google queries. These
  launch caps are not a guaranteed currency budget or provider-query cap. Numeric
  token/query counts are logged without prompt bodies; query counts are also
  recorded when response validation rejects the display payload. Set Google Cloud
  spend alerts and inspect actual billable usage.
- Request body: 8 KiB, message: 1,000 characters, body-read timeout: 5 seconds.
  Interpretation output: 900 tokens; search output: 1,600; provider timeout: 25
  seconds; nutrition work has a 55-second deadline, with separate bounded
  authentication/database calls of 8 seconds each. Independent API reads: 8 seconds/160 KiB,
  USDA: eight candidates, OFF: five. No automatic provider retries or unbounded
  tool loops. Citation/text/widget caps are shared with the client.
- The model receives current food/clarification, relevant explicit preferences,
  and at most four filtered recent messages (500 characters each). History uses
  specific owner/date reads, not months of logs. Profile targets are read from
  `user_goals` when displaying actual settings, not copied into durable memory.
- Chat retention is 30 days and 50 messages per thread, including removal of
  replay copies. Explicit preferences remain until edited/deleted. No derived
  memory summaries exist. Clear chat and clear preferences are distinct controls;
  neither deletes food history. Confirmed provenance remains with the food log.
- Drafts expire at the earlier of 30 minutes or local midnight. A timezone change
  before confirmation also requires a new review. History/summary date reads use
  local start and next-day boundaries, including DST. Device IANA timezone is
  validated; Philippine locale fallback is Asia/Manila, otherwise UTC.
- There is no shared nutrition cache. Each new independent lookup is fresh;
  portion-only edits reuse retained original basis. Explicit preferences and
  personal foods remain private. `store:false` disables Interactions conversation
  storage, but does not eliminate Google's separate grounding processing retention.

## Supported flows and limitations

Bee supports one food or defined dish per request, portion corrections, fresh
food/preparation changes, explicit Add/Edit/Cancel, durable name/units/usual
product/preparation preferences, recall/forget/edit/clear, new conversations,
and actual owned today/yesterday/date-offset food history. Multiple separate
foods require individual entry; repeating a meal asks which recorded item because
existing logs have no meal category.

Fudgee Barr needs flavor and package size; a bar, a ten-bar serving and a full
pack remain distinct. Unknown mass/density/count conversions ask for a label.
Owned native-unit foods can have unknown grams and still use their actual serving
basis; the legacy finite-grams editor instead asks for input. Missing macros or
conflicting records require manual label entry. The existing editable AI sheet
locks its reviewed serving; edited names/macros become user-entered data with the
original source/formula removed. Full source provenance is stored by the new
server-confirmed Bee flow; the legacy editable manual save path remains manual.

Automated matching checks structured identity, units/basis, finite values,
conflicts, and exact independent source-ID URLs. It cannot establish that a
crowdsourced/manufacturer record is current or that every live Google claim is
correct. Google answers are displayed with provider citation metadata and intact
suggestions; they are not automatically verified or converted to a log.

## Verification and remaining release checks

Run:

```sh
npm run typecheck
npm test
npm run lint
npm run typecheck:functions   # Deno 2 installed
npm run test:db              # Docker + PostgreSQL 16 image
npm run build:web
npx expo export --platform android --platform ios
npm audit --omit=dev --audit-level=critical
```

The PostgreSQL runner uses a disposable container without host ports, production
credentials, or real user data. It checks RLS/grants, row locking, concurrent and
lost-response confirmation, failure recovery, stale workers/actions, atomic shared
quotas/search caps, native serving bases, memory deletion/replay cleanup, retention,
local midnight/DST, timezone changes, and summary failure separation. Unit tests
mock paid APIs; nutrition numbers in fixtures are explicitly marked test data.
Browser checks use intercepted auth/functions/database requests at 375/768/1440 px.

Verified locally on 27 September 2026:

| Check | Result |
| --- | --- |
| Application TypeScript and Expo lint | Passed |
| Unit / mocked integration tests | 389 tests across 27 suites passed |
| Deno 2.9.6 checks | All three changed Edge Functions passed |
| PostgreSQL 16 | 30 behavior groups passed against the actual migration |
| Expo exports | Web, Android and iOS passed |
| Chrome with controlled fixtures | Review/source/actions, immediate dashboard refresh, display-only Search, preference add/edit/delete/clear, reload, new conversation, cancellation and provider-error retry checked; screenshots in ignored `output/playwright/` |
| Dependency audit | **Failed on the unchanged baseline lockfile:** 34 advisories, including critical `shell-quote` and `tar` advisories. No dependencies were added/upgraded. The existing CI audit gate remains enabled; resolve these before release in a separate dependency patch. |

Browser walkthroughs had no unexpected failed requests or application console
errors. Existing React Native/Reanimated deprecation and multiple Supabase-client
warnings remain. A deliberately injected 503 tested the recoverable error state.
Fixture arithmetic/screenshots are test data, not live nutrition verification.

Security check: JWT authentication, owner-scoped reads and writes, every new
table's RLS/grants, service-only fixed-search-path RPCs, stale/expired reviews,
row locking and idempotency, shared concurrent quotas, bounded input/output and
timeouts, account-switch races, source provenance, and prompt/markup injection
boundaries were checked. Provider secrets remain server-only. Fixed external
API destinations reject redirects; there is no user-controlled server page fetch.
Search content cannot authorize writes or become retained nutrition. Existing
dependency advisories above remain a release blocker. Auth/password handling,
payments, and uploads were not changed.

Live Gemini, USDA/OFF quality, exact real Search Suggestions variants, native
keyboard/link behavior, and same-account web/device end-to-end confirmation still
require a configured **staging** project and a mobile device/emulator. Deno checks
and native exports establish type/bundle compatibility, not a device walkthrough.
The plain PostgreSQL image verifies pruning but does not contain the Supabase
Cron extension; verify the scheduled job in staging.

## Safe recovery

Before app rollout, revert a failed function deploy to the previous function build
and leave the additive tables/columns in place. After rollout, disable Search with
`GEMINI_SEARCH_ENABLED=false` and redeploy both AI endpoints if provider problems
occur; manual/barcode flows and deterministic confirmed reviews remain available.
Keep the Gemini endpoints for rollback clients so shared atomic quotas remain in
force; do not redeploy the old non-atomic quota implementation alongside Bee.
Roll the UI back independently if necessary. Never drop food logs, provenance,
memories, or new tables as a rollback shortcut. Retry a failed summary refresh;
never insert the same confirmed food again to repair totals.
