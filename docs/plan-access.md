# Bee access by plan

The user's 19 October 2026 decision supersedes the earlier Plus Search allowance.
Pro inherits Plus features. No prices or billing providers change here.

| Feature | Basic | Plus | Pro |
| --- | --- | --- | --- |
| Manual tracking, barcode lookup, personal foods and recipes | Yes | Yes | Yes |
| Read a nutrition label from a camera/library photo | — | Yes | Yes |
| Food suggestions and one-food nutrition assistance | — | Yes | Yes |
| Live web search | — | — | Yes |
| Adaptive chat, explicit preferences, progress and reviewed weight/goal actions | — | — | Yes |

Plus retains **60 shared requests**, 160,000 input / 50,000 output tokens each
billing month. Label reading, suggestions and model-based food help share that
budget. Its Search allowance is now zero. Pro retains 250 requests, 50 Search
queries, 30 insights, 800,000 input / 200,000 output tokens. Private evaluation
continues to use its separately capped seven-day grant; it is not a subscription.

Suggestions are one to three generated food ideas based on the user's request.
They contain no generated nutrition amounts and do not create a review or diary
entry. Choosing a food/portion starts a permitted source lookup; a label still
requires review. Plus receives no profile biometrics or progress snapshot in this
model call. Pro retains its bounded owner-scoped adaptive context.

Search checks occur in both application code and the restricted database
reservation RPC. A Plus lookup can fall back to an independent nutrition source
without launching Search. An explicit web request receives `pro_required` before
a paid model attempt. Hiding a button is not the access boundary. Label reading
continues through authenticated `ai-label`, never a client-side provider key.

## Rollout and recovery

1. Run `npm test`, frontend/function typechecks, lint and `npm run test:db`.
2. Apply migrations through `20261019000000_private_bee_preview.sql`, then
   `20261019000100_pro_search_policy.sql`. The new file replaces only entitlement
   resolution and Search admission; it preserves existing subscriptions, usage,
   diary rows, owner RLS and service-only grants.
3. Deploy the updated `bee-chat`; rebuild/export the client to show matching plan
   wording and the food-suggestion shortcut. No new secrets are required.
4. The checked-in compatible `ai-food` also enforces this policy. Its public
   migration must still be coordinated with `usda-search`; the earlier deployed
   legacy pair remains separate until that reviewed cutover. Do not claim the
   old Vercel app has changed merely because the new Bee backend is deployed.

Use the existing global Bee disable flag or revoke an evaluation grant to stop
new model use. Keep additive migrations/data. A rollback must not restore Plus
Search permissions accidentally; use a reviewed forward migration if business
policy changes. Public release remains subject to the documented dependency,
credential rotation, legal, billing and native-device gates.

## Verification

On 19 October the seventeenth migration was applied to the linked private Bee
backend, and `bee-chat` was redeployed. The localhost web export was rebuilt;
the public Vercel client and old legacy endpoint pair were not released.

978 tests / 64 files, frontend/function typechecks and lint passed. The full
disposable PostgreSQL suite and 17 Deno handler tests passed. Controlled browser
checks passed at 375/768/1440 with no unexpected errors or failed requests.
Provider calls in the tier/suggestion/photo tests are mocked; no fake paid
subscription was inserted into production to exercise Plus.

`supabase/tests/tier_policy_database.mjs` runs against disposable PostgreSQL with
synthetic subscriptions. It checks Basic/Plus/Pro capabilities, Plus denial
without charging Search, service-only RPC grants and Pro's concurrent Search
cap. Fake-provider endpoint tests cover suggestions without writes, no private
progress context, Plus independent fallback and explicit Search denial. Browser
checks cover tier wording, suggestion requests and label-reader access at
375/768/1440; screenshots and real execution outcomes are recorded in the
current private rollout report.
