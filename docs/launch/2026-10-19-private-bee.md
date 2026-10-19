# Private Bee evaluation — 19 October 2026

This is a restricted backend rollout for the user's localhost preview. It is
**not the public web/native release** and does not enable purchases. The October
DeepSeek decision supersedes the September Gemini specification.

## Applied setup

- Applied all 17 migrations in filename order through
  `20261019000100_pro_search_policy.sql` using `supabase db push --linked`.
  Remote migration history now records the actual applied files.
- Deployed `bee-chat` and `ai-label`. They validate sessions using Auth `getUser`
  themselves; gateway legacy-JWT verification is disabled deliberately to support
  current Auth signing keys. Unauthenticated requests receive 401.
- Left the deployed legacy `ai-food` / `usda-search` source pair unchanged.
  Updating project secrets bumps platform versions; downloaded legacy ai-food
  and its shared helpers were compared byte for byte afterward.
- Enabled a service-granted private evaluation for the email-verified account with an adult profile age
  supplied by the user. Account identity is kept out of repository instructions.
  No payment, subscription or fabricated receipt was created.
- Enabled server-only `BEE_AI_ENABLED`, `DEEPSEEK_SEARCH_ENABLED`,
  `DEEPSEEK_LABEL_ENABLED`, `DEEPSEEK_DATA_USE_CONFIRMED`; configured
  `DEEPSEEK_MODEL=deepseek-v4-pro`, `DEEPSEEK_VISION_MODEL=deepseek-flash`.
  Reused the existing encrypted provider key; no secret entered a client bundle.
- Kept public release, legal approval, payment and optional analytics flags off.
  The privacy gate covers this explicitly requested personal evaluation, not
  legal approval for processing every customer's private body/diary data.
- Applied the user's [plan decision](../plan-access.md): Plus includes camera
  label reading and non-search food suggestions; Pro includes both plus live
  web search. Only Plus's former Search allowance changes, from ten to zero.
  The server and restricted reservation RPC enforce the split. Redeployed
  `bee-chat`; rebuilt the localhost client. No new secret or payment activation.

The app at **http://localhost:8091** uses the real linked Supabase backend.
Sign in normally, then choose **Ask Bee**. Its private-test label distinguishes
this unpaid evaluation from a subscription. The preview server is loopback-only.

## Access and budgets

`bee_preview_access` is additive, owner-readable with RLS, and writable only by
service role/operator. No grant is seeded by a migration. It expires after seven
days and permits 20 turns, six web searches, three dashboard insights, 350,000
input tokens and 285,000 output tokens. A fixed grant timestamp is the usage
period: there is no monthly refill inside that evaluation. Admission uses the
existing atomic reservation locks, token accounting and replay protection.
Normal paid subscriptions take precedence and retain their original limits.
Other Basic accounts receive no new AI access. Evaluation does not renew/bill.

A failed provider attempt is metered conservatively when actual usage is absent;
failures before a provider attempt release the user-turn reservation. Add,
Cancel and stored reads do not call the paid model. The legacy endpoints retain
their old policy (seven free monthly, 100 Pro daily); this narrow rollout does
not claim that the pending full client/billing cutover has occurred.

## Runtime corrections

- Optional model fields may be null/blank without invalidating a valid reply.
  Required identity, portions, units, populated fields and capability enums
  still validate. Unknown fields and write commands remain rejected.
- A generic whole egg keeps “whole” in its identity rather than treating it as
  a packaged-product flavor that disables USDA lookup.
- Irrelevant or conflicting packaged OFF products cannot block a generic-food fallback. Mixed boiled/poached records cannot answer a boiled-only question.
- Completed food reviews use server-calculated text directly, removing the second paid paraphrase and its failure/number-rewriting risk. The planning/accounting call must still succeed. No model reply authorizes a diary write.
- Portion follow-ups such as `130g`, `how about 200g?` and `what about 200 grams?`
  retain the last food and preparation. A current independent review reuses its
  original source basis without another paid model/search call; a known query
  awaiting evidence triggers that same food lookup with the new portion. Without
  food context Bee asks which food. Changed portions require a new review.
- Stored evidence compares serving and nutrient values rather than JSON field
  order. PostgreSQL JSONB can reorder fields without changing them; this must
  not cause a source-backed portion correction to be rejected. Changed values
  and unsupported source/serving conversions still fail validation.

Existing source/serving validation, exact provenance, pending versions, local
midnight checks and atomic confirmations remain authoritative. Web answers are
transient display-only; they are never promoted to a shared nutrition index or
food-log evidence. Label values require user review. Ordinary Pro is not a
vision model; photo transcription uses the separately configured Flash model.

## Recovery and future setup

Before rollout: every new scalar check and recipe validator passed against live
aggregate counts. A public-schema data backup was encrypted locally and its
decryption verified; plaintext was removed. A schema-only production copy was
rehearsed in disposable PostgreSQL 16. Counts and original-column digests across
food logs, summaries, personal foods, recipes and goals matched after migration.
Existing weights gained undated, explicitly marked baselines; old targets were
not recalculated.

For another authorized environment, review the chain and deploy only the intended
endpoints; do not reset the database or blanket-mark migrations applied:

```sh
supabase db push --linked --dry-run
supabase db push --linked
supabase functions deploy bee-chat ai-label --project-ref <project-ref> --no-verify-jwt
# Set reviewed server secrets using an ignored environment file:
supabase secrets set --project-ref <project-ref> --env-file supabase/functions/.env
```

The existing `SUPABASE_URL`, anon/publishable and service-role configuration,
`DEEPSEEK_API_KEY`, and `USDA_API_KEY` remain server-side. Do not remove old
DeepSeek/Tavily secrets until the old deployed callers have been cut over.

Disable new model calls immediately with `BEE_AI_ENABLED=false`. Revoke one
preview by deleting its `bee_preview_access` row via an operator/service-only
session. Both controls preserve diaries, preferences and chat. Keep additive
migrations; do not drop tables for rollback. Recheck permission, expiry and
current pending state before any confirmation. Backup restore is a reviewed
recovery operation, not a routine way to disable this feature.

## Verification

Local deterministic checks use synthetic source/account data and mock paid APIs.
Real PostgreSQL checks cover ownership/RLS, action locking, response-loss replay,
failed inserts, midnight/DST boundaries, grant expiry, distinct concurrent
requests and search caps. See the final verification section below for actual
command results and the separate live-account test outcome.

Official references checked: [DeepSeek chat API](https://api-docs.deepseek.com/api/create-chat-completion/),
[Search API](https://api-docs.deepseek.com/api/search/),
[platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html),
[privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html),
[Supabase migrations](https://supabase.com/docs/guides/deployment/database-migrations).
Stateless requests are not a zero-retention or no-training guarantee.

## Final checks and practical limits

- `npm test`: 978 tests across 64 files passed, using mocked paid APIs and
  explicitly identified synthetic nutrition fixtures.
- `npm run typecheck`, `npm run lint`, `npm run typecheck:functions`: passed.
  Frontend checking is not being used as evidence for Edge Function types.
- `npm run test:db`: real disposable PostgreSQL 16 checks passed, including
  the new preview grant/cap/replay invariants; 17 Deno endpoint tests passed.
  The complete 16-file migration chain also passed against the schema-only
  production copy before the actual push.
- The seventeenth policy migration passed the full disposable PostgreSQL suite,
  including Basic/Plus/Pro capability checks, zero Plus Search charges,
  concurrent Pro caps, private-evaluation precedence and service-only RPC grants.
  The baseline test failed on the old Plus allowance before the migration.
- Production web export/finalizer and controlled recipe/chat checks passed at
  375/768/1440, including long-message wrapping, private-test labeling,
  superseded review buttons, cancel, library saves and separate diary actions.
  These controlled UI checks use mocks, not real customer histories.
- Updated label/suggestion/plan checks passed at all three widths: Plus sends
  `food_assist`, suggestions alone make no diary or photo request, label reading
  keeps its separate review/confirmation, Basic controls stay disabled and Pro
  inherits label/suggestion access. No unexpected page errors or failed requests.
- Actual provider readiness confirmed HTTP200 and available balance without
  displaying balances, keys, prompts or private profiles. Live authenticated
  chat and anonymous401 checks were separate from the mocked tests.
- Live end-to-end test in a designated temporary account: 72 g whole boiled
  egg resolved from actual USDA evidence; energy matched whole-kcal rounding
  and all macros matched one-decimal server scaling. A question created zero
  diary rows; explicit confirmation created one; the same request replay
  returned success with exactly one row. No nutrition number was hardcoded.
- Live rice follow-up test used the actual TrackBing Gist record: `600 g cooked
  white rice` → `130g` → fresh server load → `how about 200g?`. Food, preparation
  and original evidence stayed the same; server arithmetic matched each portion
  and corrections made zero additional model calls. Old/cancelled Add requests
  returned `stale_action`; no diary rows were created. The temporary account was
  removed. This separately reproduced and verified the JSONB ordering fix.
- The same account's real Bee history loaded in Chromium at 375/768/1440 with
  zero page errors or failed requests. The test's food, summary and account were
  then removed. This does not establish physical native-device behavior.
- The temporary operator-only readiness endpoint was removed after diagnosis.
- `npm run ci:audit` remains blocked: 21 high affected packages, principally
  the unresolved braces/node-forge advisories and expired exception policy.
  No exceptions were renewed or release gates bypassed. The historical USDA
  credential still requires revocation/replacement confirmation.

On a phone/desktop browser, sign in at localhost, open Ask Bee, ask one food
question, read the serving/source, and choose Add, Edit or Cancel. Saved
preferences have separate controls; starting/clearing chat does not clear the
diary. Use the label reader only when you explicitly want to upload a label;
manual entry remains available. Public Vercel is still the old client.

Physical iOS/Android testing, live label-photo transcription, production
website release checks, legal/operator approval, payment configuration and
provider spend alerts remain separate release work. The live Search branch
can take tens of seconds; requests have bounded deadlines and recoverable
errors. No automatic check can prove that a public nutrition record describes
the exact food in front of the user. Matching preparation/product/serving and
checking the package remain necessary.

## Security review

Security check: verified JWT-derived ownership, owner-only RLS/service-only
preview grants and privileged RPCs, source/unit validation, immutable reviewed
payloads, atomic confirmation/replay, quota locks, bounded provider requests,
private retention and safe source URLs. The new staged diff passed a redacted
secret scan. No new secret or authorization issue was found in the focused
review. Existing dependency advisories and historical credential recovery remain
open; this is not a clean public-release security sign-off.

Final live inventory has one authorized preview grant, zero controlled test
accounts and no readiness endpoint. All five original application tables retain
their original row counts and original-column digests after cleanup.

## Public launch checklist

These statuses distinguish implementation from release. Earlier detailed local
and hosting evidence remains in [release readiness](2026-10-18-release-readiness.md)
and [hosting setup](2026-10-19-release-connection.md).

| # | Status | Evidence | Remaining operator/release action |
|---|---|---|---|
| 1 | Partial | Public `app/privacy.tsx`, Profile/auth links; DeepSeek/label notice | Approve operator identity, contact, retention and legal basis. |
| 2 | Partial | Public `app/terms.tsx`, direct export | Approve legal decisions and publish reviewed policy. |
| 3 | Partial | Server-only provider key, owner RLS and restricted RPC tests | Revoke historical USDA key; resolve dependency security gate. |
| 4 | Partial | Known Vercel origin and HTTPS setup evidence | Verify new public release redirects/headers after authorized deployment. |
| 5 | Implemented | Essential auth separate; optional analytics off; consent controls/tests | Approve optional provider before enabling tracking. |
| 6 | Implemented | Export finalizer checks public metadata/private noindex | Verify deployed new HTML. |
| 7 | Partial | Branded 1200×630 asset and configured-origin metadata support | Verify social previews on authorized new deployment. |
| 8 | Implemented | Expo favicon/native icon assets, verified export | Check real browser/store presentation at release. |
| 9 | Partial | Public-only crawler generation; indexing remains disabled | Approve legal pages/origin, then verify live crawler files. |
| 10 | Partial | Labeled controls and controlled browser checks | Real VoiceOver/TalkBack walkthrough. |
| 11 | Implemented | Existing optimized art and measured export evidence | Retain native/store visual checks. |
| 12 | Partial | Prior web performance report; smaller entry bundle retained | Deployed mobile/desktop Lighthouse and native startup measurements. |
| 13 | Partial | Existing contrast changes/tests; readable Bee review actions | Complete assistive-technology/device visual audit. |
| 14 | Partial | Controlled Bee checks at 375/768/1440 | Complete physical iOS/Android walkthrough. |
| 15 | Partial | Custom not-found and local HTTP404 tests | Confirm actual HTTP404/deep links on new Vercel deployment. |
| 16 | Partial | Finalizer internal-link checks and encoded source URLs | Recheck live legal/support/citation links at release. |
| 17 | Implemented | Client validators, backend schemas and PostgreSQL guards/tests | Test production auth/OTP delivery with operator configuration. |
| 18 | Partial | JWT denial, atomic AI budgets, finite private cohort | Verify Auth CAPTCHA/OTP limits and spend alerts; full legacy cutover. |
| 19 | Partial | Consent-gated sanitized Plausible path; disabled by default | Approve account/cost/retention; native analytics remains off. |
| 20 | Implemented | Auth primary action, dashboard Ask Bee, explicit review actions | Complete first-time/returning native walkthrough. |
