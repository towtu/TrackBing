# Adaptive Bee, subscriptions and deployment

Implementation on `feat/bee-conversation`, draft PR #10. This is reviewable code,
not evidence of a production deployment or live Gemini/store/payment verification.
The controlling specification is `TrackBing_Gemini_Search_Migration_README.md`,
identical to the user's Downloads `(2).md` (SHA256
`6bb5bfcca18160b1b3733e41efc05eab3580780e4b148753d8c0b28f5bb0738b`).
That revision adds Basic/Plus/Pro subscriptions, provider verification, monthly
billing-anniversary allowances, paywalls and modeled contribution economics to
the preceding adaptive food/weight/goal brief.

## Responsibilities and boundaries

- Expo web/iOS/Android share Bee chat, reviewed actions, Memories and manual
  weight history. The existing diary, dashboard events and nutrition calculator
  remain authoritative. No new competing diary or AI food catalog.
- `bee-chat` validates the actual session, resolves the server's tier, loads a
  small fresh owner snapshot, and runs at most two non-search Gemini decisions.
  Runtime schemas allow only named capabilities and eight existing mascot poses.
  The model selects wording and reads; it cannot execute SQL, arbitrary HTTP,
  notifications, food/weight writes or target changes.
- `beeAdaptiveTurn.ts` implements adaptive conversation/insights. Plus receives
  only food assistance without goal/weight/preference context. Basic makes no
  model calls. Saved context is reassembled each request; no Google-side session.
- `beeNutrition.ts` searches private foods, USDA and Open Food Facts. Brand,
  preparation, whole/white, variant, package and serving compatibility are
  checked before a result can produce a draft. Explicit numeric portions are
  retained from the user's text even if the model misinterprets the amount.
  Code scales canonical values, converts oz/kJ, and requires supported mass/count
  or volume basis. No assumed density, invented mass or manufactured missing macros.
- `beeProviders.ts` is the sole stateless Gemini Interactions adapter:
  `gemini-3.8-flash`, medium thinking, `store:false`, 4,096 output tokens per call,
  separate JSON planning and Google Search calls. Internal reasoning is excluded
  from user-facing output. Server secrets never enter the Expo bundle.
- Search automatically follows a genuine independent-source miss, once product
  details are sufficiently clear. Greetings, confirmations and direct hits do
  not search. Google answer text, citation annotations and required Search
  Suggestions display together in the isolated web/native renderer.
- **Google results remain transient and answer-only.** Their text, links,
  suggestions, query corpus and numbers are neither cached, fed into future
  model context, promoted into an index, nor used for a diary proposal. The
  persistent thread keeps a neutral refresh placeholder. A barcode/independent
  record or user-owned manual label is required to log. No harvesting of cited links.
- `bee_pending_actions` stores a server-created exact review. PostgreSQL locks
  owner/thread/action, checks status/version/expiry/timezone/tier, inserts once,
  and consumes the action in one transaction. The originating capability and current tier are both checked. No macros/weight/targets are
  accepted in a confirm request. A stale button or superseded review cannot write.
  Completed request replays recover the original write after a lost response.
- Dashboard/Stats/summary refresh and manual weights use the validated saved
  account timezone, with explicit start/next-day boundaries including DST.
- `weight_logs` stores dated kg measurements plus original kg/lb and timezone.
  Unknown-date legacy current weights are explicitly labeled baselines. One
  manual RPC serves Profile and Stats; Bee uses the same canonical writer.
  Backdated/edit/delete operations synchronize the latest profile weight without
  changing nutrition targets. Baselines stay distinct from editable dated records.
- Goal proposals reuse the existing calculator and age guards, show previous
  and proposed calories/macros/mode, retain target weight, and require another
  confirmation. Profile revision checks reject stale proposals and stale manual
  form saves. With fewer than two comparable dated measurements, no trend exists.
- Dashboard insights are non-search, private, revisioned and bounded to 24 hours
  or local midnight. Food/profile/weight/memory changes invalidate them. Mascot
  renders/taps do not pay for new insights; taps open Bee. An insight does not
  advance a conversation's reviewed version. Offline fallback stays deterministic.

## Database additions and rollout order

Keep all existing migrations in their normal order. The original unversioned
TrackBing tables now have an idempotent first migration,
`20260613000000_legacy_base_schema.sql`, so a fresh project can bootstrap.
Existing projects keep their rows. When linking an existing project whose migration
history starts after this timestamp, review the schema and use Supabase’s
`--include-all` flag only if its dry run shows this unapplied older migration.
The complete chain applied on a clean, isolated local Supabase stack on
2026-09-28. `scripts/test-supabase-local.py` also exercised two real local Auth
sessions, owner RLS, weight retry, local-day totals and Bee's JWT/thread checks.
This is local verification, not a production migration or live Gemini test.
New feature migrations:

1. `20260915000000_bee_conversations.sql` — owner-scoped threads/messages,
   explicit memories, food pending actions, turn leases, independent provenance,
   atomic food confirmation and original usage infrastructure.
2. `20260927000000_launch_validation.sql` — additive `NOT VALID` constraints
   protect new writes without discarding legacy rows, restrictive owner policies,
   finite/range guards and independent atomic USDA proxy rate limiting.
3. `20260928000000_adaptive_bee.sql` — generic food/weight/goal actions, weight
   history/baselines, profile revision/timezone, context revisions and insight
   storage, canonical manual weight/profile RPCs and atomic adaptive confirmations.
4. `20260929000000_subscription_budgets.sql` — private verified subscriptions,
   events, billing accounts/requests/customers/checkouts, shared monthly usage,
   call/Search accounting, entitlement resolution and private progress/insight RPCs.
5. `20260930000000_billing_actions.sql` — private receipt/account/payment
   bindings, billing leases, confirmation tier enforcement, unified replay
   invalidation/retention, server-only food provenance guards, explicit-day weekly Stats boundaries and fail-closed retirement of the old AI quota RPC.

Every user-owned addition has RLS. Clients can read only their own permitted
records; service-only data/RPCs are revoked from anon/authenticated/public. Manual
profile/weight RPCs derive `auth.uid()` internally. Foreign references include
owners. Privileged functions use a fixed `public,pg_temp` search path. No body user
ID is trusted by the Edge Functions.

**Staged release:**

1. Back up the database and compare the real schema with migration assumptions.
   A fresh isolated project starts with the idempotent base migration above;
   do not run a synthetic test fixture against production.
   Review invalid legacy values before validating `NOT VALID` constraints later.
2. Disable existing AI entry points for the short migration window. Retire old
   clients' free-AI promise in release communication. The final migration makes
   an old AI function fail closed rather than retain a second exploitable cap.
3. Verify actual historical paid receipts/contracts. Import only documented
   periods into `verified_legacy_subscriptions` and reconcile them as `legacy`.
   Never promote a client-controlled `pro_until`. If any legacy contract differs
   from this policy, resolve it before rollout, not by guessing access rights.
4. Apply all migrations to an isolated environment; run database tests.
5. Deploy all six functions and configure disabled sandbox secrets; no client
   should call a missing endpoint/table. Register signed provider notifications
   and scheduled reconciliation before enabling purchases.
6. Deploy the shared client and build new native binaries with the IAP plugin
   (Expo Go cannot exercise this native purchase module). Configure the approved
   `ios.bundleIdentifier` and matching Apple bundle ID/store products; the existing
   Android package/store configuration must also match the verified receipts.
7. Validate with adults/test accounts and Google paid-service configuration.
   Test receipt/checkout, renew, cancel, expire, grace, refund, replace, restore,
   account switch and concurrent confirmations in each provider sandbox.
8. Enable a small authorized cohort, monitor metrics, then authorize wider rollout.
   Deployment/merging are separate operator actions; this PR does neither.

Safe commands (replace placeholders; use ignored files, not inline credentials):

```sh
supabase db push --dry-run --linked
supabase db push --linked
supabase secrets set --env-file supabase/functions/.env --project-ref <project-ref>
supabase functions deploy bee-chat --project-ref <project-ref> --no-verify-jwt
supabase functions deploy ai-food --project-ref <project-ref> --no-verify-jwt
supabase functions deploy usda-search --project-ref <project-ref> --no-verify-jwt
supabase functions deploy billing --project-ref <project-ref> --no-verify-jwt
supabase functions deploy billing-webhook --project-ref <project-ref> --no-verify-jwt
supabase functions deploy billing-reconcile --project-ref <project-ref> --no-verify-jwt
```

For an existing project whose history predates the new base migration, first
review `supabase db push --dry-run --linked --include-all`. Apply with
`supabase db push --linked --include-all` only when that output names exactly
the intended unapplied migrations and the live schema comparison is complete.
Do not use a synthetic fixture or `db reset` on a linked project. The local
Auth/RLS smoke test requires an isolated local Supabase workdir and a Bee
handler at `http://127.0.0.1:8000/` (or set `TRACKBING_LOCAL_BEE_URL`):

```sh
TRACKBING_LOCAL_WORKDIR=<isolated-local-workdir> python3 scripts/test-supabase-local.py
```

`--no-verify-jwt` disables only the gateway's legacy JWT check: the three user
proxies and billing validate the session with Supabase Auth on every request.
Webhooks instead verify provider HMAC/JWS/OIDC. Scheduled reconciliation requires
its own constant-time checked server-only credential. Do not publish a gateway
exception for any function without the corresponding handler authentication.
Supabase supplies its existing server URL/anon/service-role values. Keep real
`.env*` ignored; safe templates are root and `supabase/functions/.env.example`.

## Server configuration

Required for paid AI: `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.8-flash`,
`GEMINI_SEARCH_ENABLED`, `BEE_AI_ENABLED`, `GEMINI_PAID_DATA_USE_CONFIRMED=true`.
The last flag is an operator assertion after reviewing paid-service data handling;
blank/false denies private model calls. Cloud AI requires an actual age >=18 in
Profile. Unpaid Google service restrictions make this gate necessary. Manual
tracking continues independently. USDA retains `USDA_API_KEY` server-side.

Billing configuration:

- `BILLING_PRODUCTS_JSON`: exact provider/product/tier/monthly-or-annual mapping;
  Google entries include their exact base-plan ID. Four products per provider,
  no introductory offers/free trials. One Apple group, Pro ranked above Plus.
- `PAYMONGO_ENABLED`, `PAYMONGO_LIVE`, `PAYMONGO_SECRET_KEY`,
  `PAYMONGO_WEBHOOK_SECRET`, `BILLING_SITE_ORIGIN` (real HTTPS origin).
  Enable Subscriptions/Maya with PayMongo. Configure automatic monthly/yearly
  PHP plans at the disclosed amounts. Server checks plan price/currency/interval.
- `APPLE_BUNDLE_ID`, `APPLE_APP_ID` (production), `APPLE_KEY_ID`,
  `APPLE_ISSUER_ID`, `APPLE_PRIVATE_KEY`, `APPLE_ROOT_CA_BASE64` (verified Apple
  certificate bytes, comma-separated). Official Apple's verification library
  checks signatures/environment/bundle/account, with online certificate checks.
- `GOOGLE_PLAY_PACKAGE`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`,
  `GOOGLE_PUBSUB_AUDIENCE`, `GOOGLE_PUBSUB_SERVICE_EMAIL`.
  Grant minimum Publisher permissions; authenticated Pub/Sub pushes must match
  configured audience and service email. Receipt ownership uses the account hash.
- `BILLING_SANDBOX=true` only in isolated testing. Production rejects test Play
  receipts; Apple verification selects the exact configured environment.
- `BILLING_RECONCILE_SECRET`: independent random >=32-character scheduler secret.
  Schedule a server-side POST every few minutes to `billing-reconcile`, with
  `Authorization: Bearer <secret>` stored in a secrets manager. Each run verifies
  three oldest stale subscriptions from provider servers; tune frequency for
  account volume and alert on non-200 responses. Never ship this secret to Expo.

Webhook URLs: `billing-webhook?provider=web`, `...=apple`, `...=google`.
Register correct environment-specific endpoints and event coverage. Web refund
handling joins verified payment IDs to their invoice; full successful refunds
and matched disputes revoke that cycle. Partial refunds retain access. Unmapped
refunds return retryable failure and need operator reconciliation; do not ignore
those alerts. A delayed paid event cannot revive a revoked invoice. Newer paid
cycles can restore access. Store replacements recheck the linked old Play token;
replacement cancellations are expired rather than retained through an old date.
Use provider sandboxes to confirm actual event payloads/ordering before release.

Web checkout creates an idempotent recurring **Maya** first-invoice payment flow.
This UI does not implement a card-entry widget or promise GCash. Web users can
cancel renewal/change plans for the next paid cycle; native users purchase,
restore and manage through StoreKit/Play with their actual localized price.
There are no PayMongo checkout links in native purchase UI. Web return URLs never
unlock access. Highest verified overlapping tier applies, with duplicate warning.

Public build configuration/optional consent is documented in
[public-web.md](launch/public-web.md). Real public origin, operator/contact, reviewed
legal copy and optional Plausible account are still operator inputs.

## Allowances, retries and operating limits

| Tier | Monthly interactions | Search queries | Insights | Input / output tokens |
| --- | ---: | ---: | ---: | ---: |
| Basic | 0 | 0 | 0 | 0 / 0 |
| Plus | 60 food assistance | 10 | 0 | 160,000 / 50,000 |
| Pro | 250 food/chat | 50 | 30 | 800,000 / 200,000 |

One account shares counters across endpoints/devices. Each requested paid turn
is one interaction, not one charge per internal model step. Insights have their
separate 30-refresh allowance and share token/Search ceilings. Annual purchases
receive monthly allowances on the UTC account billing anniversary, clamped for
short months; never twelve months of credits at once. Upgrades do not reset usage.
No background food searches, per-device loophole or extra user overage billing.
Manual work, Add/Cancel, actual diary history, reading/exporting/deleting saved
preferences and fresh cached insights need no model request. A downgrade retains
all records but blocks new Pro memory/actions and invalid-tier confirmations.

Account locks enforce 15 paid starts/minute and one in-flight provider turn.
USDA has its separate 30 authenticated searches/minute. Model turn deadline is
55 seconds; external structured retrieval has its own bounded timeouts/content.
Requests stream through a UTF8 byte cap/body deadline, up to 2,000 chat characters.
Output/schema/truncation failures fail closed. No automatic paid retries.

Reservations cover 15,000 input / 12,288 output tokens for a bounded turn;
unused capacity is released. Actual usage is deduplicated per call. A failed
preflight is uncharged. Once provider work was attempted, measured (or
conservatively reserved unknown) cost and the interaction are retained; the same
request cannot launch paid work twice. The UI can start a new turn after a
provider failure. Near a token ceiling there must be room for a complete bounded
turn, so some remaining tokens may not be usable individually.

Search reserves up to three queries before launch and reconciles to actual
reported query count, refunding unused reservations after a successful response.
Failed/unknown provider work retains the reservation. Google's model can execute
more queries in flight than reserved; actual excess is counted and subsequent
requests denied. This is a bounded-call/cap defense, **not an API-level guarantee
that Google executes at most three queries**. Absorb in-flight excess without
charging the user. Set provider billing alerts/project spend ceilings and use
`BEE_AI_ENABLED=false` as the circuit breaker. Missing usage is conservative,
not silently zero. Metrics contain numeric tokens/counts only, no prompt bodies.

Chat is owner-private: 30 days/50 messages per thread, six recent messages in model
context; pruning removes expired content/replays. The first migration schedules hourly
`bee_prune_all_history()` when pg_cron is available; otherwise configure a
service-only hourly scheduler. Verify that job before promising inactive-account retention. No transcript
summary/embedding may resurrect deleted preferences. Preference deletion fences
other threads and invalidates replays/derived insights. Explicit memories persist
until edited/deleted/account removal; confirmed diaries and weights are retained
as the user's data. Billing ledger retention/backups/account erasure require an
operator-reviewed policy; no invented legal retention promise. Cached insights
expire at local midnight/24h and are invalidated on underlying record changes.

No public nutrition cache was added. Independent provenance (record ID, URL,
identity, timestamp, basis, original nutrients, attribution/license) stays in the
owner's reviewed/saved food. USDA is public-domain source data; OFF attribution/
ODbL is preserved and must be reviewed for any future aggregate database. Existing
manual/barcode/search remain. Automated compatibility/evidence checks cannot
prove a third-party label is current or that model prose is true. Exact API values
and typed review arithmetic are trusted; unclear/missing/conflicting identity,
macros or conversion goes to clarification/manual label entry. No label-image OCR
or AI estimate promotion was implemented.

## Validation and limitations

See [launch report](launch/2026-09-27-implementation-report.md) for all twenty
launch items, commands, measurements and the manual walkthrough. Unit and Edge
provider tests use marked deterministic fixtures; PostgreSQL tests run real PG16
in an ephemeral Docker container. Existing schema compatibility is tested, not
production Supabase deployment. Browser checks intercept Supabase and make no
real account writes. Native exports are builds, not physical-device verification.

Still required before shipping: live paid Gemini/USDA source checks; verified
store/PayMongo product setup, credentials/webhooks/sandbox lifecycle tests;
provider-terms/legal review; real origin/HTTPS/404/social/Lighthouse verification;
actual native device/VoiceOver/TalkBack/keyboard/purchase tests; old paid-contract
migration and user communication. No production deployment is claimed.

## Recovery

Disable paid AI and checkout first if errors rise; keep Basic/manual records
available. Do not drop additive tables, pending actions, weights, billing ledger
or food provenance. Keep migrations forward-only. Old pre-migration UI binaries
may fail closed for AI, so prefer rolling forward to a fixed shared client/function
rather than restoring obsolete quota code. Reconcile uncertain provider receipts
and pending checkouts before initiating new payments. Back up/restore only in an
isolated audited procedure; never erase users' diaries to roll back Bee. Summary
refresh failure does not undo a successful food insert; recompute derived totals.
Never remove DeepSeek/Tavily production secrets until deployed old callers have
been retired, although the checked-in execution path no longer uses them.

## Primary references checked

- [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash),
  [Interactions](https://ai.google.dev/api/interactions-api),
  [pricing](https://ai.google.dev/gemini-api/docs/pricing),
  [Additional Terms](https://ai.google.dev/gemini-api/terms).
- [PayMongo subscriptions](https://docs.paymongo.com/docs/payment-acceptance-subscriptions),
  [subscription resource](https://docs.paymongo.com/reference/subscription-resource),
  [refund resource](https://docs.paymongo.com/reference/refund-resource).
- [Apple official verification library](https://github.com/apple/app-store-server-library-node),
  [Play subscription state](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2).
- [USDA API](https://fdc.nal.usda.gov/api-guide/),
  [Open Food Facts reuse](https://world.openfoodfacts.org/data),
  [Supabase function auth](https://supabase.com/docs/guides/functions/auth).

The brief's contribution table is an assumption-based cost model, not actual
profit or live verified storefront proceeds. Recheck prices, FX, taxes, commissions,
refunds and measured per-user usage before enabling the proposed catalog.
