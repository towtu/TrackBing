# Combined Bee and launch-readiness implementation plan

> **For agentic workers:** Use subagent-driven-development for independent owned tasks, with focused spec and quality review before handoff.

**Goal:** Preserve the implemented Gemini Bee flow while completing locally actionable work for all 20 launch checks and reporting real deployment/operator dependencies.

**Architecture:** Public Expo routes render signed out and statically; private screens stay authenticated/noindex. Consent gates a configured optional analytics adapter. Forward-only SQL guards existing user data and rate limits proxies. Export tooling checks public metadata/assets/links without claiming production verification.

**Tech Stack:** Existing Expo Router, React Native, TypeScript, Supabase/PostgreSQL and Vercel; no paid account provision or production deploy.

- [ ] Inventory all 20 items before edits; preserve user work and feature commit.
- [ ] Public routes: privacy/terms drafts, legal links, usable signed-out static home/auth, metadata/social/favicon, robots/sitemap, branded HTTP-404 configuration.
- [ ] Consent and analytics: explicit optional choice, decline/accept/revoke, bounded sanitized events, Profile controls; native scope separate.
- [ ] Security and data: whole-product secret/RLS/RPC audit, additive validation and proxy limits, client form bounds, quota HTTP behavior, dependency advisory patches justified by launch scope.
- [ ] Usability/assets: measure contrast, icon labels/touch targets/focus, responsive flows, lossless/appropriate compression and lazy barcode code.
- [ ] Verification: deterministic and SQL tests, application/backend type/lint, actual exports, browser screenshots/public-private interactions, local performance, native tooling availability, external API primary docs.
- [ ] Final review and delivery: one row per launch item with evidence and exact operator steps, scoped commits/update existing draft PR; no production deploy/merge.

Sensitive data includes auth tokens, biometrics, diary content and Bee preferences. Worst cases are cross-owner access, accidental logging, leaked secrets, or optional telemetry revealing food/profile details. Keep server-owned confirmations/RLS, sanitize telemetry to enumerated route/event names, and require consent before any optional network call. Unknown legal/domain settings remain clearly marked and unset.


## Updated implementation scope

The exact Downloads `(2).md` is now the controlling spec: Basic/Plus/Pro billing, monthly account-level budgets, adaptive 3.8 Flash read planning, generic food/weight/goal reviews, synchronized dated weigh-ins and private revisioned dashboard insights. Implementation preserves the earlier independent-source food path and transient-only Google answer policy. Review findings and verified/operator-blocked items are tracked in `docs/launch/2026-09-27-implementation-report.md`; no production release or store/provider approval is inferred from local builds.
