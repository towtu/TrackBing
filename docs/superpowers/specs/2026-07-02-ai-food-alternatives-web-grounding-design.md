# AI Food Logging: Alternatives + "Find more" Web Grounding

**Date:** 2026-07-02
**Branch:** feat/ai-macros
**Status:** Approved design

## Problem

The deployed `ai-food` pipeline (DeepSeek v4-flash interpret → personal foods →
USDA → OpenFoodFacts → AI estimate) works for common foods but fails on branded
and local Filipino foods ("Tender Juicy cheesedog") because USDA/OFF don't know
them, and it returns exactly one candidate — if the match is wrong (raw vs
cooked rice), the user has no recourse besides canceling.

Tavily is configured (API key set in Supabase secrets, `"web"` source type
already exists client-side) but is not wired into the pipeline.

## User experience

1. User types "I ate 70g of Tender Juicy cheesedog" (Bee quick log or add
   screen). Bee replies with the best match + macros, **plus up to 3
   alternative candidates** as compact tappable rows. Tapping an alternative
   swaps the proposed macros instantly — no extra AI call, no quota cost.
2. If none fit, the user taps **"Find more"** → one Tavily web search runs and
   **DeepSeek v4-pro** reasons over the results to produce better candidates
   (badged `🔎 Web`). Counts as 1 AI use against quota.
3. Confirm → logs exactly as today (existing AiFoodSheet → food_logs flow).

## Decisions (with reasons)

- **Alternatives over retry-with-correction:** swapping is free and instant;
  a retry burns quota and an API call.
- **Web search is user-triggered only ("Find more"), never automatic:** each
  Tavily search costs ~$0.008 (~₱0.45); a human deciding "this result is
  wrong" is the cheapest and most precise trigger. Protects the ₱99/mo Pro
  margin.
- **Model split — flash default, pro on Find-more:** v4-flash (thinking mode)
  handles every normal query. v4-pro is used only in web mode, where judgment
  over messy web snippets is exactly where the bigger model helps. ~4x cost
  paid only on escalation.
- **Extend the existing `ai-food` function, no new function:** shares auth,
  per-minute rate limiting, and quota code. A `mode: "web"` request field
  selects the escalation path.

## Backend: `ai-food` edge function

### Request

```jsonc
{ "query": "70g tender juicy cheesedog", "mode": "web" /* optional */ }
```

Absent/invalid `mode` → normal mode. Same auth (JWT), rate limit, and quota
checks for both modes.

### Response

```jsonc
{
  "food": { /* AiFood — best match, as today */ },
  "alternatives": [ /* 0–3 AiFood candidates */ ]
}
```

`AiFood` gains an optional `source_detail?: string`:

- `usda` → matched entry description, e.g. `"Rice, white, long-grain, cooked"`
- `openfoodfacts` → matched product name + brand
- `web` → domain of the page the macros came from, e.g. `"tenderjuicy.com.ph"`
- `my_food` / `ai_estimate` → omitted

### Normal mode (v4-flash — unchanged cost)

Instead of stopping at the first usable hit, collect top candidates across
tiers: personal foods (up to 2) → USDA (top usable results from the 5 already
fetched) → OpenFoodFacts (same). Best candidate becomes `food`, next up to 3
become `alternatives`. Zero additional API calls — today we fetch 5 results
per source and discard 4.

Candidate collection is implemented as a pure helper in
`supabase/functions/_shared/` so it is unit-testable.

### Web mode (v4-pro + Tavily)

1. v4-flash interpretation of the query is reused (name, portion grams).
2. One Tavily search: `"<food> nutrition facts calories protein per 100g"`
   (or per-serving for branded items). `TAVILY_API_KEY` stays server-only.
3. v4-pro receives the search snippets + URLs and extracts/picks the best
   per-serving macros for the user's portion, returning up to 4 candidates
   with `source: "web"` and `source_detail` = domain of the result used.
   Prompted to prefer official brand sites and known nutrition databases when
   results disagree.
4. Junk/empty web results → fall back to `ai_estimate` (clearly badged).
5. All candidates pass through `validateAndNormalize` (macro bounds,
   kcal-vs-macros consistency) before being returned.

Model IDs are constants at the top of `index.ts` (`DEEPSEEK_MODEL` for normal,
`DEEPSEEK_WEB_MODEL = "deepseek-v4-pro"` for web mode) so A/B switching stays
a one-line change.

## Client

- `src/lib/aiFood.ts`: response type gains `alternatives?: AiFood[]`; `AiFood`
  gains `source_detail?: string`; `requestAiFood` gains an options arg for
  `mode: "web"`.
- `AiFoodSheet` + `BeeQuickLog`: alternatives rendered as compact tappable
  rows under the main proposal (name, kcal, source badge, `source_detail`
  line). Tapping swaps the proposal. A "Find more" button triggers web mode
  with a loading state and replaces the candidate set with the web results.
- `AiEstimateBadge` area: pill stays as-is; `source_detail` renders as a small
  muted line under it (e.g. `from tenderjuicy.com.ph`, `matched: Rice, white,
  cooked`).
- Logging path unchanged.

## Error handling

- Tavily failure/timeout in web mode → fall back to `ai_estimate` candidates
  rather than a hard error (user already spent a quota credit; give them
  something reviewable).
- Existing error contract preserved: `rate_limited`, `over_free_quota`,
  `over_pro_cap`, `bad_request`, `unauthorized`, `ai_unavailable`.
- "Find more" disabled while a request is in flight; result errors surface via
  the existing sheet error styling.

## Security notes

- DeepSeek + Tavily keys server-only (Supabase secrets). Nothing new reaches
  the client bundle.
- `mode` is validated server-side (only `"web"` accepted; anything else =
  normal mode).
- Web mode reuses the same rate limit + quota gates; user-triggered escalation
  cannot be spammed beyond the per-minute throttle.
- Query is still length-capped (200 chars) and sent to Tavily as a JSON body
  field — never interpolated into a URL.
- Web-derived numbers pass `validateAndNormalize` before reaching the client.

## Testing

- Unit tests (vitest): candidate-collection helper (ordering, dedupe, cap at
  3 alternatives), web-result parsing/normalization, client `requestAiFood`
  web-mode wiring.
- Existing suite must stay green (`npm run typecheck`, `npm test`,
  `npm run lint`).
- Manual A/B on hard queries after deploy: "steamed white rice" (expect cooked
  entry), "Tender Juicy cheesedog" (expect web hit with brand domain),
  "adobong pusit".

## Out of scope

- Automatic brand detection routing to web search.
- Free-text correction/retry flow.
- Caching web results across users (possible later cost optimization).

## Prerequisite

The working tree has uncommitted in-flight work (Bee quick-log edits,
`foodLogEvents.ts`, `codex.diff`). That must be committed or stashed before
implementation starts.
