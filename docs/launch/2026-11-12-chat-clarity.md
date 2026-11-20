# Bee chat clarity — 12 November 2026

This focused update fixes an outgoing message remaining in the composer while
Bee waits, and a flavor/gram reply losing the product under clarification.
See [food corrections](../bee-food-corrections.md) for behavior and source policy.

## Changed boundaries

- `BeeQuickLog.tsx` renders one temporary outgoing bubble from the active request,
  with recovery on failure and existing owner/thread guards.
- `beeFoodContext.ts`, the adaptive dispatcher and deterministic portion handler
  retain food clarification fields. A bounded query-only recovery handles omitted
  structured queries, including older broken threads with recent food context.
- Nutrition preflight accepts an explicit gram portion without inventing a bar's
  package weight; count conversions and complete nutrition evidence remain required.
- The provider adapter uses a small non-thinking budget for query recovery only.
- Unit regressions and the existing CI browser creation suite cover these cases.

## Verification

The deterministic food fixtures are clearly marked TEST DATA, not real Fudgee
Barr nutrition. Browser tests intercept Auth/database/provider responses and
exercise sending, failure/editing, replay, new conversation, sign-out and account
switches at 375/768/1440 px. No existing user's diary is modified.

Local verification passed: **1,034 tests in 66 files**, frontend typecheck/lint,
seven Deno function typechecks, all 18 migrations and ownership/confirmation
invariants in disposable PostgreSQL, 17 handler tests, a cold Expo web export and
its route/metadata finalizer, workflow policy/actionlint and secret-pattern scans.
The query-only recovery was independently reviewed; red/green regressions include
null recovery with stale food and natural questions about how much a bar weighs.
The creation/recovery/pending-message browser suite passed at all three widths
with no console errors, unexpected failed requests or real-user writes.

`npm run ci:audit` passed its existing policy with 0 critical, 0 high, 19 moderate
and 1 low affected packages. This change adds no dependency or audit exception.
The required hosted CI reruns all seven browser suites and iOS/Android exports
before merge. Exports and controlled browser checks do not establish physical
device behavior. Production/provider results are reported separately in the
release handoff; local tests alone do not prove those systems are available.

## Rollout, security and recovery

No new migration, secret, provider approval, quota increase or dependency is
needed. Keep all 18 existing migrations and server credentials in place. Deploy
`bee-chat` first, then merge the tested client through the protected main branch;
the existing Vercel Git integration builds and deploys that merge.

The recovery call can return only a validated food query or null. It cannot
authorize a food/memory write, choose arbitrary URLs or access another owner.
The existing authenticated, scoped, versioned pending-action confirmation remains
the only AI diary write path. Logs contain numeric usage, not prompt bodies.

Roll back with the previous compatible function source and Vercel deployment, or
a reviewed revert and rebuild. Preserve all user data and additive schema. No
table deletion, entitlement change or credential rollback is required. Current
secret-pattern checks do not resolve the previously reported historical USDA key:
its rotation still needs confirmation in the operator's credential review.
