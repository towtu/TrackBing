# Main update — 8 November 2026

**Publishing follow-up:** the owner subsequently requested restoration of
native Vercel Git deployment and a production cutover. The newer configuration
removes `git.deploymentEnabled=false`; see [current publishing mode](../CI_CD.md).
The deployment-disabled observations below record the initial main publication,
not the restored configuration. A Git deployment still does not migrate or
deploy Supabase; compatible backend deployment must precede this web cutover.

This source update includes the existing adaptive Bee/food/weight work and the
following final fixes. Source publication and a production deployment are
separate operations.

- Public food name resolution: Gist, then bounded DeepSeek Search on a miss,
  then independent USDA. A Gist hit does not execute web Search. Exact private
  recipes/foods and explicit barcode lookups retain their existing behavior.
- Ordinary rice can use a visible cooked white rice default with server-scaled
  grams and a fresh Add review. Explicit preparation/variety and owned foods
  are preserved; missing planner details cannot authorize a conflicting default.
- Pro dashboard advice is generated from actual owner-scoped progress, cached
  by data revision/local day, with a manual-action fallback on failure. Edits
  refresh advice after persistence. Expiry refreshes both the diary date/totals
  and advice. Animation and mascot taps do not launch new paid insight calls.
- Existing browser metadata supplies the TrackBing tab title in static HTML.
- Compatible dependency patches clear the high/critical audit gate without
  weakening it or renewing exceptions. Moderate/low findings remain documented.

## Verification and boundaries

`npm test` passes **1,006 tests across 65 files**. Frontend typecheck/lint,
seven Edge Function typechecks, workflow policy/actionlint, a cold Expo web
export and its route/metadata finalizer pass. All 18 migrations and confirmation,
ownership, concurrency, date and quota checks pass in disposable PostgreSQL;
the Deno handler suite passes **17 tests**. The dependency policy passes with
0 critical, 0 high, 21 moderate and 1 low affected packages.

All seven browser suites passed with zero unexpected console/network errors.
The dashboard suite also verifies local-midnight totals/date/advice together,
failed-refresh fallback, one refresh per completed context change, and late
responses after an account switch. Browser checks use synthetic users, diary
records and provider replies at 375/768/1440 px. They do not establish live AI answer quality or physical-device
behavior. No real user's food history is changed by these checks. The new rice
lookup changes have not been verified against a live paid provider. Source
selection is structured retrieval and ranking; this update does not claim a
new embedding index or full evidence-augmented generation pipeline.

Current source/export secret-pattern checks do not prove that Git history is
clean. The previously exposed USDA credential still needs confirmed rotation;
see [credential review](2026-10-19-secret-history-review.md).

## Release and recovery

There is no new migration or server secret for these final fixes. Existing
18 migrations and the compatible function/client pair are prerequisites.
Follow [CI and releases](../CI_CD.md) for the manual staging and production
workflow: migrations, all compatible authenticated functions, then the web
candidate and verified promotion. Vercel Git auto-deployment is disabled. A
push/merge to `main` alone does not change the public site or deployed functions.
The title-only change request is superseded by this full branch.

Keep remaining legal/operator configuration, provider-account verification,
credential rotation and native-device checks explicit; source publication does
not sign those off. Roll back through a reviewed revert and rebuild, or disable
Bee server feature flags if necessary. Preserve additive tables, food/weight
history, memories and confirmation records. Reverting dependency patches also
restores their old vulnerabilities; prefer a forward fix.
