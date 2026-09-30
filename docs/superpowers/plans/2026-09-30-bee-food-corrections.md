# Bee food corrections implementation plan

> Execute inline; autonomous implementation is authorized. Preserve codex.diff.

**Goal:** Clearer chat, safe preparation continuity and gist → Search → USDA order.

**Architecture:** Existing owner-scoped Bee state and deterministic confirmation
remain authoritative. Source helpers validate external records; Google text stays
outside persisted outcomes. Expo renders one latest-reply mascot and readable macros.

**Tech stack:** Expo/React Native, TypeScript, Supabase/Deno/PostgreSQL, Vitest/Chrome.

- [x] Add failing UI helper, preparation-context and gist/source-order regressions.
- [x] Implement latest-reply rendering and legacy macro expansion in BeeQuickLog.
- [x] Implement deterministic preparation clarification and retained-query lookup.
- [x] Add fixed-URL gist validation, explicit source kind and independent USDA fallback
      to bee-chat and compatibility ai-food. Keep shared accounting and exact URLs.
- [x] Add forward-only gist source policy and real SQL confirmation/ownership tests.
- [x] Run targeted/full tests, app/functions typechecks, lint, SQL and web export.
- [x] Verify real Chrome at 375/768/1440 with controlled conversation fixtures,
      including raw/ra clarification and stale Add cancellation; inspect screenshots.
- [x] Document live-versus-branch API/memory behavior, rollout and source limitations;
      self-review security/diff, commit as towtu and update the existing draft PR.

Verification and production/API distinctions: [handoff](../../bee-food-corrections.md).
