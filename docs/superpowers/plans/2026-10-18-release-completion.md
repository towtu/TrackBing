# Release completion pass — 18 October 2026

Continue on `feat/deepseek-label-photos`; preserve the unrelated `codex.diff`.
The user authorized autonomous completion. No new framework or dependency is
needed, and a failing security gate must not be bypassed.

1. Recheck published patches, hosted configuration and public production routes
   read-only. Record deployed evidence separately from branch implementation.
2. Strengthen the existing release smoke check: verify actual public content,
   private noindex metadata, crawler policy, branding assets and safe HTTP-to-
   HTTPS redirect. Bound response bodies and overall execution. Write regressions
   first, including an app shell incorrectly returned for a legal URL.
3. Align user-visible terms and setup instructions with the active DeepSeek
   implementation, keeping operator-review drafts explicit.
4. Run application, backend/database, export, browser and dependency checks;
   independently review the diff. Protect main with its existing CI gate if the
   repository permissions support it. Do not weaken audit or invent legal approval.
5. Publish the focused commit to the existing draft PR, update the twenty-item
   launch evidence and list the exact external dependencies. Do not merge or
   deploy a release that fails its security checks.

Live provider responses, physical-device camera/accessibility, legal decisions
and unavailable hosting/payment credentials cannot be simulated as completed.
