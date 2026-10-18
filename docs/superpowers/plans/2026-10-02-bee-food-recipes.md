# Bee food and recipe creation implementation plan

> **For agentic workers:** Execute inline with executing-plans; keep existing user work and the feature branch. No production deployment or merge.

**Goal:** Bee creates reviewed personal foods and usable recipes in the existing libraries without recording consumption.

**Architecture:** Gemini selects creation intent and suggests recipe ingredients/steps. Trusted code resolves independent nutrition records, calculates totals and creates one server-owned pending action. The existing owner-scoped lease/confirmation transaction saves to `personal_foods` or `recipes` once.

**Tech stack:** Expo / React Native, TypeScript, Gemini Interactions, Supabase / PostgreSQL. No new dependencies.

## Safety and product decisions

- Creation is Pro adaptive assistance; manual My Foods and Cookbook remain free.
- Label numbers must be present in the user's current input. Unknown macros and conversions require input. Grounded answers never supply reusable food/recipe values.
- Recipes have 1–8 ingredients, 1–20 servings, and 1–8 editable cooking steps. Ingredient suggestions are reviewed, not claims of intake. Nutrition is calculated, not a measured cooked label; cooked yield is not inferred.
- Library saves are separate from diary additions. Confirmation takes only the owned pending ID/version. A correction supersedes the old review. Retry returns the original successful result.
- Existing source URLs/identities/bases and timestamps remain private provenance. Manual edits mark derived provenance as edited. No additional secrets or client-side API keys.

## Implementation and verification

- [x] Add failing tests in `_shared/beeCreation.test.ts` for strict plans, supplied label values, independent ingredient arithmetic, missing values, unsupported sources and serving corrections. Run the targeted Vitest file and confirm the missing feature fails.
- [x] Implement `_shared/beeCreation.ts` and shared wire types; extend `beeAdaptive.ts`, `beeAdaptiveTurn.ts`, `beeConversation.ts`, and `beeService.ts`. Resolve each recipe ingredient using preferred independent sources and USDA fallback only; retain creation context and bound concurrency.
- [x] Add `20261002000000_bee_food_recipe_creation.sql`: additive recipe servings/steps and protected provenance/action columns; extend typed pending actions and the existing restricted atomic finish RPC. Validate arithmetic again in SQL, preserve owner checks, leases, tiers and retention.
- [x] Add real PostgreSQL tests in `supabase/tests/creation_database.mjs`; run `npm run test:db` for owner denial, no diary writes, stale/cancelled reviews, concurrent confirmations, response-loss replay, insertion failure and protected provenance.
- [x] Extend client validation and Bee review cards; update Cookbook and recipe editor to display/edit servings and steps. Refresh the libraries after a confirmed save. Preserve legacy whole-recipe fractions and manual creation.
- [x] Run typecheck, full tests, lint, Deno checks, Expo web export and native exports. Exercise controlled browser mocks at 375/768/1440, including correction, cancel and library save; inspect screenshots/errors.
- [x] Review the diff and document deployment order, mocked vs live evidence and limitations. Commit as towtu; publish only if existing Git credentials permit, otherwise refresh the user-authored bundle/patches and PR metadata with the exact publication gap.
