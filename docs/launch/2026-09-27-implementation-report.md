# Adaptive Bee and launch implementation report

Implementation verified locally through 30 September 2026 (Asia/Manila).
Branch: `feat/bee-conversation`; review: [draft PR #10](https://github.com/towtu/TrackBing/pull/10).
**No production migration, deployment, payment activation, or merge was performed.**

## Controlling brief and delivered behavior

`TrackBing_Gemini_Search_Migration_README.md` is the exact Downloads `(2).md`,
SHA256 `6bb5bfcca18160b1b3733e41efc05eab3580780e4b148753d8c0b28f5bb0738b`.
The latest revision adds Basic/Plus/Pro subscription tiers, verified recurring web
and native-store billing, monthly account budgets, paywalls and contribution-cost
assumptions to the earlier adaptive Gemini food/weight/goal assistant. The spec
has been replaced as requested; AGENTS/PRODUCT instructions were preserved.

- A bounded, authenticated Gemini 3.8 Flash planner generates context-specific
  chat/dashboard replies and selects permitted reads and existing mascot poses.
  Food, weight and target arithmetic run in application code; writes run in SQL
  after an exact server-created review. Basic makes no Gemini calls; Plus receives
  only food assistance; Pro receives adaptive chat, memory and insights.
- Private saved foods, USDA and Open Food Facts resolve food identity and serving
  basis first. Portion corrections retain the previous source when appropriate;
  a preparation/whole-versus-white change requires a compatible lookup. Missing
  macros/conversions require clarification/manual label entry, not invented zeros.
- Google Search follows a genuine miss automatically. Citation metadata and
  Search Suggestions display together. Grounded answers are transient, answer-only:
  no shared cache, scraping lead list, future model context or diary proposal is
  built from them. Use an independent record or user-owned manual label to log.
- Food/weight/goal reviews persist across sessions. Atomic confirmation locks
  owner/thread/version, checks current and originating tier, expiry and local day,
  writes once and returns the same result on retry. A question alone never writes.
  Client macros, account IDs or dates are not accepted in confirmation requests.
- Dated kg/lb history and a labeled unknown-date legacy baseline support real
  progress. Profile/Stats share the manual writer; backdating/edit/delete recompute
  current weight and preserve targets. Goal proposals use the existing calculator,
  age safeguards, previous/new values and profile revision checks.
- Explicit preferences can be saved, revised, read, exported and deleted. Delete/
  clear invalidate derived insights and replay payloads. Sign-out/account switch
  fences old requests and remounts private UI. Clearing chat preserves the diary.
- Dashboard, Stats, summary refresh and manual weight dates use the saved account
  timezone, falling back to a validated device zone. Explicit next-midnight
  boundaries cover 23/25-hour days. Bee's today review expires at local midnight.
- Verified provider subscriptions determine allowances. Annual plans still reset
  monthly on the account's billing anniversary; upgrades do not reset counters.
  Search queries and tokens are measured separately from user interactions.
  Server web checkout uses recurring Maya; native uses StoreKit/Play, restore and
  management. Purchase/cancel/plan-change cards disclose the reviewed action.

See [deployment guide](../bee-gemini-deployment.md) for architecture, complete
configuration, tier limits, provider setup, quota/retry semantics, retention,
rollback and source/terms documentation. It distinguishes sandbox fixtures from
provider verification and does not imply legal approval or measured profit.

## Changed areas and migration order

| Area | Main files |
| --- | --- |
| Model/API/typed planning | `supabase/functions/{bee-chat,ai-food}/index.ts`, `_shared/bee{Adaptive,AdaptiveTurn,Service,Store,Providers,Request,Types,Intent,Conversation}.ts` |
| Independent nutrition/manual validation | `_shared/beeNutrition.ts`, `src/lib/{foodSearch,usda,independentNutrition,macros}.ts`, source and arithmetic tests |
| Billing | `supabase/functions/{billing,billing-webhook,billing-reconcile}`, `_shared/billing{Protocol,Providers,Store}.ts`, `src/lib/{billing,nativeBilling.*}.ts`, `app/plans.tsx` |
| Chat/dashboard/memory | `BeeQuickLog`, `BeeMemories`, `BeeGuide`, `useBeeInsight`, dashboard, account transport/events |
| Weight/targets/dates | `WeightHistory`, Profile/Stats, shared `nutritionTargets`, `accountDay`, `dailySummary` |
| Public/launch | public legal/not-found routes, `+html`, consent/metadata, image assets, colors/icons, form validation, `vercel.json`, export/security/browser scripts |
| Verification/docs | CI, unit/provider/PG tests, safe `.env.example` templates, deployment/report/audit documents |

Apply `20260613000000_legacy_base_schema.sql` first on a fresh project,
then the existing historical migrations in timestamp order. An existing project
with these tables keeps its data; inspect its schema and migration history before
including an older unapplied migration. Then apply these feature migrations:

On 2026-09-28, all 12 migrations applied in order to a clean isolated local
Supabase stack. A two-account local Auth/PostgREST/Bee smoke test passed owner
RLS, invalid JWT, cross-user thread denial, weight-write replay, and Manila
local-day totals (`scripts/test-supabase-local.py`). The CLI's local functions
proxy hit a Docker DNS error in this environment; the same Bee Edge entrypoint
was served directly by Deno against local Supabase for the handler checks.
No hosted project, Gemini key, production user, or production deployment was used.

1. `20260915000000_bee_conversations.sql` (already in the branch's first commit).
2. `20260927000000_launch_validation.sql`.
3. `20260928000000_adaptive_bee.sql`.
4. `20260929000000_subscription_budgets.sql`.
5. `20260930000000_billing_actions.sql`.

New entities include owner threads/messages/memories/pending actions, dated
weights/baselines, private insights/context revisions, verified subscriptions and
provider bindings/events, billing requests/payment links and monthly AI meters.
Existing food logs receive nullable action/provenance fields. Existing diaries,
recipes, personal foods and custom targets are preserved. `NOT VALID` legacy
constraints protect new writes without deleting invalid historical rows.

Deploy the migrations and all six functions to an isolated environment before
releasing the new client. Purchases/AI remain disabled until secrets, verified
legacy paid periods and sandbox lifecycle checks are complete. Native purchases
require a new development/store binary with `expo-iap`; Expo Go is insufficient.

## Verification evidence

| Check | Result / scope |
| --- | --- |
| `npm run typecheck` | Passed: application TypeScript. |
| `npm test` | Passed: **40 suites / 570 tests**, deterministic fixtures and mocked paid providers. |
| `npm run lint` | Passed: no errors or warnings. |
| `npm run typecheck:functions` | Passed: all six Deno Edge Function entry points; separate from frontend TS. |
| `npm run test:db` | Real ephemeral PostgreSQL 16: migration/ownership/concurrency/confirmation/weight/tier/retention/date tests; plus **17 actual Deno handler tests** with mocked providers. 36 legacy/launch checks plus five current-policy integration groups. |
| `npm run build:web` | Passed: 20 Expo routes; finalizer verifies real public HTML, metadata/noindex, internal anchors, assets, crawler gating and branded 404. |
| Expo iOS and Android exports | Passed: both Hermes bundles. Build evidence only; no native device/purchase/camera/VoiceOver/TalkBack run. |
| `scripts/check-web-ui.cjs` | Real Chrome at **375 / 768 / 1440 px**, public/protected routes and Bee interactions, controlled Supabase fixture. No real user writes. |
| `node scripts/check-secrets.mjs --dist` | Pattern scan of tracked source and web export; values are never printed. No detected server credential; not proof against every possible credential format. |
| `npm audit --json` | **16 advisories: 1 high, 15 moderate, 0 critical** after compatible patches. Not a clean audit. |

The database suite exercises the earlier food-only migration and its original
business policy first, then the final current subscription policy. Legacy test
names mentioning seven free lookups/100 Pro/day/20 searches describe that earlier
migration, **not current Basic/Plus/Pro limits**. Final-policy tests cover shared
monthly budgets, actual Search-query refunds/counts, forged entitlement denial,
origin-tier confirmation, canceled/stale/downgraded actions, atomic weight/profile
sync, duplicate/concurrent food confirmation and response-loss recovery, owner
provenance protection, replay deletion and explicit DST next-day exclusion.

Native billing tests verify listener/connection cleanup after catalog failure and disposal.
Generated-reply tests reject premature first-person, shorthand and passive save claims
without confusing actual saved preferences with a new write.

The provider runtime tests validate real request-handler code, JWT failure,
HMAC/tampering/environment cases, unpaid checkout, invoice plan changes, refund
reconciliation failures and provider response bounds. They do not establish live
Google answers, Apple certificate/store receipts, Play purchases, renewals or
actual web payment success. SQL tests use two isolated fixture users and actual
RLS/RPC privileges; no production Supabase database was contacted.

Reproduce browser verification after `npm run build:web` using a static server
that maps known clean URLs to their own HTML and unknown URLs to `404.html` with
HTTP 404, then:

```sh
PLAYWRIGHT_MODULE=<installed-playwright-module> CHROME_BIN=<chrome-binary> \
  UI_BASE_URL=http://127.0.0.1:8091 node scripts/check-web-ui.cjs
```

Screenshots/results: ignored `output/playwright/adaptive-launch/`. The fixture
labels nutrition numbers **TEST DATA** and intercepts every Supabase request.
Do not install it in production. Expected diagnostics: deliberate unknown URL
HTTP404 and camera permission denial in the headless test; manual barcode entry
remains visible. Unexpected exceptions/network failures must be zero.

### Performance, assets and remaining audit risk

- Existing eight Bee poses plus logo/icon were losslessly recompressed:
  **2,261,348 → 2,084,824 bytes**, saving **176,524 bytes (7.8%)**, no changed pixels.
- Selective icon imports reduced the main web entry from about **8.39 MB to 2.82 MB** (entry:2,818,880 bytes; common:507,203; index:32,481; runtime:3,802).
  This is still above the static-public-site 100 KB JS budget. The app's React
  Native web/runtime bundle remains a material performance limit.
- Legal and branded404 export pages ship **zero JavaScript**. Public home contains
  actual signed-out content in initial HTML; it still hydrates the shared app.
- Social asset: **1200×630**, **127,530 bytes**. Store icon remains existing artwork;
  its 476×428 source needs reviewed 1024×1024 native store artwork before submission.
- Patched Expo54/Vitest releases, `brace-expansion` and same-major PostCSS were
  applied without changing RN/Expo major. The explicit PostCSS override is the
  patched compatible build dependency; remove it once upstream ships the fix.
  Remaining high advisory: Metro's `image-size@1.2.1` image-parser denial of service.
  Its fixed v2 API is incompatible with Metro's current default import. Do not
  process untrusted assets through the development/export pipeline. Plan a tested
  Expo/Metro upgrade; no forced major upgrade is hidden in this PR.
- No deployed Lighthouse/PageSpeed score, LCP/INP/CLS, HTTPS status, native startup
  measurement or social-provider preview was obtained. Local export is not that evidence.

## Manual walkthrough / release acceptance

**Executed locally, web with controlled fixtures:** signed-out entry/privacy/terms/
unknown404; signed-in dashboard, food search, scanner/manual fallback, Profile,
Stats, Plans; open Bee, exact weight review/Confirm, food review/Cancel, grounded
answer with Search Suggestions and no pending write, Memories. All three widths
have no horizontal overflow. Accessible names, visible public-link keyboard focus,
modal scrolling and recoverable/loading states were inspected. Headless camera
access is denied intentionally. No real hardware scanning was claimed.

**Executed against real isolated local Supabase, without Gemini or production
accounts:** signup/onboarding and target save; create a clearly labeled
`LOCAL-TEST-DATA` personal food; submit food search, review a 100 g serving,
log it and observe the dashboard update immediately; reload and verify the
entry persists. Profile's dated weight review/cancel leaves history unchanged;
review/confirm saves one measurement and synchronizes current weight while
preserving the calorie target. These were disposable test-account records, not
live-source nutrition or real users' diary entries.

### Follow-up fixes and verification, 30 September

- Packaged-food text search now uses `world.openfoodfacts.org`, the documented
  production host, rather than the US-market subdomain. The prior host failed
  CORS in the local browser and restricted product coverage to the US market.
  A real browser request to the world host returned HTTP 200 with a readable CORS
  response; no real product calorie figure was used as demonstration data.
  The new mocked source test checks the encoded query and that a complete
  illustrative product record remains available to food search. See the
  [official Open Food Facts API guide](https://openfoodfacts.github.io/openfoodfacts-server/api/).
- Food-search header/search-clear controls and both responsive food-review
  layouts expose button roles and accessible names. Portion unit selection and
  save busy/disabled states are announced; Android's modal back action dismisses
  the review. Existing layout, nutrition calculations and diary writes are unchanged.
- The expanded browser regression exercises manual review, portion increase/
  decrease and keyboard cancellation without inserting food, alongside the
  existing Bee/public/account checks. All nutrition in this regression is marked
  illustrative test data. Screenshots and results stay under ignored
  `output/playwright/adaptive-launch/`.
- Application/function typechecks, lint, 570 unit/integration tests, the full
  PostgreSQL/17-handler suite, the web export and credential scan were rerun.
  Audit remains 16 advisories (one high, 15 moderate); no dependency was changed
  in this follow-up. The web build uses public build-only placeholders and the
  browser harness intercepts Supabase calls, so it needs no live API credential.
- The actual PR preview at
  `https://track-bing-git-feat-bee-conversation-towtus-projects.vercel.app`
  returned HTTP 308 to HTTPS. HTTPS `/privacy` returned a Vercel sign-in redirect,
  not the app page. App headers, live 404, legal content, social previews and
  Lighthouse therefore remain unverified on that protected preview. No attempt
  was made to bypass protection or deploy to production.

**Deterministic unit/SQL acceptance:** 72 g fixture arithmetic and cooking method,
100 g correction, egg-white replacement, brand/package clarification, bar versus
pack, per-serving/per100g/kJ conversion, unsupported volume/missing macros,
unretrieved citations/invented evidence, prompt-injection boundaries, no/yes
clarification separation, no write without review, duplicates/retries/stale actions,
insert rollback, account isolation, memory revision/delete, actual owned yesterday
logs, Manila midnight/DST, failed provider/schema/key/quota and concurrent usage.
Fixtures contain illustrative values; none are presented as live-source nutrition.

**Still run on isolated live services and a native device before release:**

1. Configure adult test accounts on Basic/Plus/Pro. Confirm Basic dashboard/taps
   and exhausted paid plans make zero provider calls; manual food/weight/goals work.
2. Ask 72 g boiled egg, revise100 g, change to whites. Inspect actual source/basis,
   Add, immediate totals and retry/second-device exactly-once behavior.
3. Ask Fudgee Barr, supply flavor/size; inspect independent match or actual Google
   citations/Suggestions. A grounded-only answer plus “yes” must not log anything.
4. Remember/revise/delete/recall a preference, clear chat, sign out/switch account
   and reload on web plus native. Verify private persistence and isolation.
5. Review72.4 kg, cancel, correct to lb, confirm, backdate/edit/delete in Profile/
   Stats. Check one measurement has no trend and targets never change implicitly;
   separately review a valid goal change and reject a stale profile revision.
6. Exercise offline/timeout/malformed provider/quota/save failure and midnight in
   Manila plus a DST zone; retained review/retry must not insert a duplicate.
7. Sandbox web/store purchase, restore, renew, grace, cancel, expire, refund,
   delayed/out-of-order notification, downgrade and Play replacement. Verify prices,
   environment/account binding, no return-URL entitlement and shared monthly budgets.
8. Review real-domain headers/direct routes/social/crawlers/Lighthouse, camera,
   keyboards/safe areas, VoiceOver/TalkBack and real mobile purchase management.

## Security review

**Security check:** session validation, explicit owner-scoped service calls, RLS,
composite ownership references, fixed-search-path RPCs, restricted privileges,
row-locking/idempotency and current/originating-tier guards were inspected and
exercised in PostgreSQL. Clients cannot create server reviews, inject approval
payloads, forge food provenance, read other accounts or bypass legacy quota RPCs.
Food edits retain and mark the original provenance snapshot as user-edited.
Provider events require verified HMAC/JWS/OIDC/account bindings; a return URL or
client tier never grants access. No AI/user/page/memory text grants write authority.
External source fetches use fixed HTTPS destinations and reject redirects; UI
citations use metadata and safe URLs. Grounded HTML is isolated/sanitized and app
buttons stay outside it. Request/response bytes, time, model steps/tokens and
quota reservations are bounded. Logs record numeric usage/errors without secrets,
prompts, measurements or payment bodies. Optional analytics obey consent/privacy
signals and allow only sanitized routes/events. Memory/chat deletion fences replay
and insight caches; inactive-account retention requires the documented cron job.

Findings/limits: dependency audit is not clean; a citation cannot prove a current
label or every model sentence; Google results are therefore answer-only. Actual
provider sandbox lifecycle, deployed database permissions/cron, account-erasure/
backup policy, spend alerts and legal/source/provider terms require operator
verification. Supabase sessions retain the existing client architecture; this PR
does not claim server-cookie protection for a client-only Expo app.

## Twenty-item launch evidence

“Implemented” below means locally implemented and checked, not production launch
approval. “Partial” includes native or real deployment checks still outstanding.

| # | Status | Evidence | Exact remaining operator action |
| --- | --- | --- | --- |
| 1 Privacy | Partial | `/privacy`, legal links, processor/control draft, static export and three-width Chrome checks | Approve operator/contact, rights/erasure/backups/retention and Google/billing processing; native route walk. |
| 2 Terms | Partial | `/terms`, signed-out access, Basic/Plus/Pro/AI limits and payment draft | Approve age/refund/tax/dispute terms and effective date; native walk. |
| 3 Secrets / access | Implemented | Safe env templates, tracked/dist scan, real PG owner/RPC/provenance tests | Configure server-only secrets and verify policies on isolated deployment before release. |
| 4 HTTPS | Blocked | HTTPS-only adapters; Vercel configuration; protected PR preview redirects HTTP→HTTPS308, app page is inaccessible | Supply real production origin or accessible isolated preview; verify app TLS/headers/camera, then decide HSTS. |
| 5 Consent | Implemented | Optional web consent, DNT/GPC, accept/decline/revoke tests; tracking off by default | Enable optional tracking only after provider/privacy approval; native analytics remain off. |
| 6 Metadata | Implemented | Exported public titles/descriptions/content and protected noindex checks | Verify deployed HTML after final operator configuration. |
| 7 Social preview | Partial | Branded1200×630 PNG and conditional OG/Twitter metadata | Set real HTTPS origin and inspect deployed social previews. |
| 8 Favicon | Existing and verified | Export favicon and existing icon preserved; browser screenshots | Review1024×1024 native store art and deployed tab icon. |
| 9 Sitemap / robots | Partial | Public-only generation; drafts/unknown origin deny indexing; route tests | Set real origin and approved legal configuration; verify deployed crawler files. |
| 10 Accessibility | Partial | Image/control labels, food-review portion/close/save semantics, keyboard cancellation, public focus and three-width Chrome checks | Complete VoiceOver/TalkBack/full keyboard and scanner/recipe workflows on devices. |
| 11 Images | Implemented | Ten lossless assets,176,524 bytes saved, unchanged pixels | Review native store artwork separately; optimization did not replace it. |
| 12 Speed | Partial | Entry~66% smaller; zero-JS legal/404; measured export assets | Run mobile/desktop Lighthouse on real origin and native startup; meet remaining JS/performance budget. |
| 13 Contrast | Implemented | 37 WCAG color-pair tests; text/errors/borders/citations adjusted | Verify device rendering/focus states during final accessibility walk. |
| 14 Mobile friendly | Partial |375/768/1440 Chrome route/interaction checks; iOS/Android Hermes exports | Run one real native target: keyboard/safe areas/camera/purchases/account continuity. |
| 15 Not found | Partial | Branded route/export404; local known URLs and actual unknown HTTP404 | Verify known deep links and unknown404 status on Vercel. |
| 16 Links | Partial | Automatic exported internal-anchor checks; validated/encoded source/legal URLs | Inspect live source/support links and native deep links on configured origin. |
| 17 Validation | Implemented | Auth/OTP/forms/weight/date/pending/billing checks; real SQL finite/owner guards | Review invalid legacy rows before later validating additive constraints. |
| 18 Spam / quotas | Partial | Real JWT verification, atomic shared paid budgets and USDA limit, signed billing events | Configure Supabase Auth/CAPTCHA/rate limits, project spend alerts and deployed cron/webhooks. |
| 19 Analytics | Partial | Consent-gated sanitized optional Plausible web adapter; private usage/billing ledger | Approve provider/retention/cost; configure aggregate conversion/retention/refund reporting and native strategy. |
| 20 Clear CTA | Implemented | Signed-out sign-in/create; free manual actions, reviewed paid boundaries and one adaptive Pro suggestion | Review first/returning paths in final live/native walkthrough. |
