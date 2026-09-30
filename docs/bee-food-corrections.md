# Bee chat clarity, food corrections and source priority

Implemented on `feat/bee-conversation`, included in draft
[PR #10](https://github.com/towtu/TrackBing/pull/10). Production is not deployed by
this change. The user's untracked `codex.diff` is preserved.

## Behavior

- Only the latest assistant reply has a chat mascot. A live Search answer owns
  that mascot when present; the header art remains. Earlier replies retain
  alignment without repeated artwork.
- Macro review text spells out **Protein**, **Carbohydrates**, **Fat**, and grams.
  Old contiguous `P… C… F…` assistant macro groups expand for display without
  altering stored text or nutrition numbers. Unrelated product identifiers stay.
- Missing raw/cooked chicken preparation prompts a question before retrieval.
  `raw`, `uncooked`, cooking-state and skin corrections preserve the current food
  and portion. Preparation embedded in a previous name is replaced too.
  `ra` asks “Did you mean raw …?”; Yes resolves that question into a new lookup,
  never a diary write. Without an existing food, Bee asks which food.
- A changed portion reuses the retained source basis when valid. A fresh review
  replaces the previous action; historical cards show status without an Add button.
  Both Pro chat and Plus food-assistance text bind confirmation to the reviewed ID.

## Sources and evidence

Bee and compatibility `ai-food` use the fixed
[towtu foods gist](https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json)
first. An exact owned food or Open Food Facts/barcode record remains usable before
paid Search. On a genuine miss: **Google Search next, USDA as the final independent
fallback**. A gist hit requires neither Google nor USDA. Clarifications do not search.
Existing manual search and barcode workflows remain available.

USDA receives the original normalized food query, never Google answer text or
links. If it supplies a matching independently obtained record, Bee can display
that record's separate review alongside the transient Google answer. Compatibility
`ai-food` returns the independent food instead. Explicit web-only compatibility
requests remain answer-only. A failed/disabled Google call can still use USDA if
there is time left; shared quota denial fails closed.

Gist requests use one fixed HTTPS URL, reject redirects, cap each response at
160 KB/500 rows, and time out after eight seconds within the existing 55-second
turn budget. The live fixed-URL read returned HTTP 200 with 258 rows on 30 September
2026. This verifies availability, not nutritional accuracy. No new shared cache
or harvested Google-link collection is created. Retained reviews remain stable
when the public gist changes; the next lookup retrieves a fresh copy.

Gist mass rows follow the app's existing **c/p/cb/f per 100 g** contract. Legacy
serving/volume rows require explicit `nutrition_basis: "per_100g"`; otherwise Bee
skips them. A display unit or serving_weight alone does not prove the basis or
food density. Unsupported count/volume conversions and missing macros require
clarification/manual entry, never zeros or invented mass.

Gist reviews say **TrackBing curated foods**, with medium confidence in the legacy
contract and `operator-provided` attribution. They are not USDA verification.
The retained exact URL, original row, basis, selected identity, source ID and
retrieval timestamp accompany the review and personal diary provenance. Scaling
compares the original row values with the retained basis as well as its snapshot.
These checks detect internal mismatches; they cannot establish that an operator's
original values are correct or legally reusable. The operator remains responsible
for the gist's accuracy and source rights.

Google answers/citations/Search Suggestions remain transient and outside persisted
food/action payloads, future model context and shared indices. Google-only numbers
cannot create a log proposal. Use independent records or user-provided label/manual
values; see [Google's terms](https://ai.google.dev/gemini-api/terms).

## Which API and what memory?

A read-only check of `https://track-bing.vercel.app` on 30 September found the legacy
`ai-food` client and “Does this look right?” copy, with no `bee-chat` caller. Main's
corresponding backend uses DeepSeek V4 Flash, and Tavily plus V4 Pro for web
extraction. The public bundle cannot prove the deployed function's code/secrets.
That older component retains chat only while mounted and sends corrections as
standalone lookups.

This feature branch uses the server-side Gemini Interactions adapter with
`GEMINI_MODEL` (default `gemini-3.8-flash`). Owner-scoped threads restore bounded
30-day chat and structured food context. Explicit saved preferences persist until
edited/deleted, with controls in Saved preferences. A raw correction changes this
conversation's food; it does not silently create a permanent preference.
Provider setup, Pro/Plus entitlements and the migrations must exist before the new
client can use those capabilities. No live paid Gemini call was used to verify this
patch. See [the deployment guide](bee-gemini-deployment.md).

## Rollout and recovery

Apply the existing feature migration chain, then
`20260930000200_gist_food_source.sql`, before deploying updated `bee-chat`, `ai-food`
and the Expo clients. The forward-only migration extends the existing restricted
atomic confirmation RPC with a fixed gist-source policy; it adds no table, client
write grant, broad RPC or destructive data change. It fails closed if the expected
predecessor function differs.

```sh
# Review linked project and dry run first; use an isolated project for verification.
supabase db push --dry-run
supabase db push
supabase functions deploy bee-chat
supabase functions deploy ai-food
npm run build:web
```

Keep `GEMINI_API_KEY`, model/Search flags, paid-data-use approval, Supabase service
credentials and `USDA_API_KEY` server-only. This patch needs no new secret. Retain
old provider secrets until deployed callers have been checked. Roll back code via
an approved previous release if needed; keep the additive schema and users' logs,
chat, preferences and action history. Never drop those tables to undo UI changes.

## Verification

The regression fixtures are explicitly illustrative TEST DATA, not live food facts.
The automated Chrome walkthrough intercepts Auth/database/functions and writes no
real users' food history. It covers raw clarification → ra → Yes → 609 g review →
100 g correction → No; macro labels; one mascot; stale Add removal; Search widget;
existing weight/memory/manual-food flows at 375/768/1440 px.

Verified results on 30 September 2026:

- `npm test`: **46 suites / 618 tests passed**, including deterministic provider,
  source-order, preparation, macro-label and latest-avatar regressions.
- `npm run typecheck`, `npm run lint`, `npm run typecheck:functions`: passed;
  the latter checks all six Deno Edge Function entry points separately.
- `npm run test:db`: real disposable PostgreSQL 16 passed the full migration,
  owner/RPC, stale/cross-owner gist action, concurrent exactly-once/replay,
  quota/date/weight and cascade tests; **17 Deno handler tests** passed.
- `npm run build:web`: 23 exported routes and static export checks passed.
- iOS/Android Expo Hermes exports passed, including all existing Bee artwork.
- `scripts/check-web-ui.cjs`: Chrome at **375/768/1440 px** passed the controlled
  flows above; zero unexpected console errors/failed requests. Expected camera
  permission denial in headless Chrome was recorded separately.
- Tracked/generated web secret-pattern and diff checks passed. These are pattern
  checks, not proof against every possible credential format.
- `npm audit --omit=dev`: **16 existing advisories, one high (`image-size`),
  15 moderate, zero critical**; no dependencies were added or upgraded.

Browser evidence: `output/playwright/adaptive-launch/results.json` and screenshots
in that directory. Generated artifacts remain ignored. Physical iOS/Android,
live Gemini/Google Search and deployed database/application verification remain
operator release checks; native exports are build checks only.

**Security check:** real session/owner boundaries, server-only review creation,
restricted RPC grants, atomic confirmation/replay, fixed HTTPS destinations,
bounded retrieval, preparation/variant compatibility, unchanged quota accounting,
source snapshots and grounded-data isolation were reviewed and tested. External
food/memory/model text cannot dispatch a write. No server secret was added to the
client. Existing dependency advisories and the limits of source validation remain
release findings, not a clean production-security claim.
