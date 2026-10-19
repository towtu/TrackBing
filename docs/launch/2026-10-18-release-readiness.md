# TrackBing release readiness — updated 19 October 2026

**Not released.** Code is on `feat/deepseek-label-photos`, in stacked draft
[PR #11](https://github.com/towtu/TrackBing/pull/11), based on
[PR #10](https://github.com/towtu/TrackBing/pull/10). The October DeepSeek choice
supersedes the Gemini provider in the September brief. Neither PR was merged.
Two unresolved high dependency advisories still block the release gate.

**19 October setup update:** the existing Vercel project is now linked and its
future build settings and production mappings are verified. Releases remain
disabled; deployment credentials and staging identities are still missing.
The [hosting connection record](2026-10-19-release-connection.md) supersedes
the initial empty-configuration observations below and records the removed
public USDA variable and limited exposure check.

**19 October hardening:** completed confirmation retries now survive a saved
timezone change; altered commands still conflict and new turns use the saved
timezone. Audit failures retain the validated underlying blocker IDs. Removed
unused styling packages (51 lockfile packages, no unrelated upgrades), five
starter assets and four empty directories; consolidated types/documentation and
archived old generated evidence. [Cleanup details](../project-structure.md)
record paths and recovery. Both security exceptions remain expired/unchanged.

**Credential recovery:** a redacted Git-history scan found an older hardcoded
USDA key. [Revoke and replace it](2026-10-19-secret-history-review.md) before
calling the security launch item complete; current-file scans do not revoke it.

## Completed in this pass

- Strengthened the existing candidate/live release check: actual legal content,
  head metadata, private noindex, exact crawler policy, branding bytes matched
  against the trusted local build, commit identity, unknown-route HTTP 404,
  same-origin HTTP→HTTPS redirect and unauthenticated API denial. Commented,
  scripted, duplicate and body-only metadata cannot satisfy the check. Downloads
  are bounded to 1 MiB/page, 16 KiB/crawler, 512 KiB/image and 1 KiB/identity;
  requests have 15-second timeouts and the run has a 90-second deadline. Hosting
  responses never execute code or authorize a write. Bypass credentials are
  sent only to the configured HTTPS deployment, never to HTTP or Supabase.
- Corrected current Terms and the safe server-secret template to name DeepSeek
  and optional reviewed label-photo transcription. Legal approval remains false;
  no operator identity, contact or legal decisions were invented.
- Matched the sign-up/sign-in toggle's accessible names to its visible text and
  preserved the logo's actual577:277 image ratio without changing its layout.
  Browser assertions cover both the accessible label and rendered image ratio.
- Applied and read back GitHub `main` protection: PR required, up-to-date
  **Ready to merge** from GitHub Actions, administrators included, conversations
  resolved, force push/deletion disabled. No minimum human approval was imposed
  on the owner-operated repository. `staging` and `Production` environment branch
  policies now allow protected branches; `main` is currently the only one.
  Their credentials/mappings are not configured and releases remain disabled.
- Rehearsed all 15 existing migrations against a fresh schema-only production
  snapshot in disposable PostgreSQL 16, then passed label budget replay,
  cross-owner denial and concurrent exactly-once confirmation. No production
  rows were copied, queried for content, changed or deleted. No new migration
  was needed for this release-check increment.

## Read-only production findings

Origin: **https://track-bing.vercel.app**, supplied previously by the user and
verified reachable on this date. This is the older deployed app, not PR #11.

- HTTP `/` returns 308 directly to HTTPS; TLS succeeds and Vercel sends HSTS.
- `/`, `/privacy`, `/terms`, `/profile` and a unique unknown path all return
  the same 25,913-byte app shell with HTTP 200. The public legal content and real
  unknown-route 404 from this branch have not reached production.
- `robots.txt`, `sitemap.xml`, `social-preview.png` and `release.json` return 404.
  The configured nosniff/CSP/camera/referrer headers are absent on current HTML.
- Supabase has only `ai-food` v10 and `usda-search` v4 deployed. Both deny the
  empty unauthenticated probe with 401. `bee-chat`, `ai-label` and `billing`
  return 404. No paid lookup, recovery email or signed-in diary request was sent.
- The production secrets list contains `DEEPSEEK_API_KEY`, `USDA_API_KEY` and
  the old `TAVILY_API_KEY`, plus Supabase-managed secrets. Only secret names
  were inspected; values, billing, provider validity and live model quality
  were not tested. Do not delete Tavily while the old endpoint still uses it.
- All seven existing public data tables have RLS; inspected policies scope
  records to `auth.uid() = user_id`. New Bee/weight/billing tables are absent.
  The remote migration history is empty despite legacy tables being present.
  Successful schema rehearsal does not prove existing row data satisfies every
  new constraint. Review the dry run and legacy data validation before applying.
- Email Auth is enabled and email auto-confirmation is disabled. The public
  settings endpoint does not establish transactional SMTP, CAPTCHA or delivery.
  The initial 18 October Actions configuration was empty; the 19 October setup
  supplement records the production mappings now applied. Deployment secrets
  remain absent. An EAS project ID exists in `app.json`, but its cloud ownership/
  credentials are unverified and the iOS bundle identifier is missing. No Android
  device/emulator or local provider key is available.

## Verification

| Check | Result / boundary |
| --- | --- |
| `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers 2` | Passed 19 October on Node 24.21.0; 944 tests / 63 files, including timezone-retry, retained-blocker diagnostics and eight rendered web-ring regressions |
| `npm run typecheck:functions` | All seven Edge Functions checked with Deno; separate from application TypeScript |
| `npm run test:db` | Disposable PostgreSQL migration/ownership/locking/replay/quota invariants and 17 Deno handler tests passed |
| Current-schema rehearsal | All 15 migrations plus label ownership/retry/concurrent confirmation passed; schema-only, PostgreSQL 16 |
| Linked migration dry run | Passed; lists all15 unapplied migrations and explicitly performs no migration push |
| `npm run build:web` | Passed; 23 static routes, real configured origin, legal drafts/no indexing, export finalizer |
| `npm run ci:browser -- --all` | Seven suites at 375/768/1440 passed 19 October; mocked accounts/providers and synthetic camera, no unexpected errors. Initial parallel run timed out under severe local memory pressure; serial rerun passed without increasing timeouts. |
| Actual export through strengthened smoke adapter | Real exported HTML/crawlers/assets accepted; hosting statuses/headers and API responses simulated, not deployed evidence |
| iOS / Android Expo exports | Both Hermes exports passed; no signed binary or physical-device test |
| Workflow policy / actionlint with ShellCheck | Passed |
| Current tracked/web/native secret-pattern checks | No findings in the current files; not proof against every unknown credential format |
| Git-history secret audit | Gitleaks 8.30.1, 266 locally reachable commits: historical hardcoded USDA credential found; rotation required. Public anon JWT / SQL false positive triaged separately. [Recovery](2026-10-19-secret-history-review.md). |
| `npm run ci:audit` | **Failed as intended:** zero critical/moderate; both high blocker IDs now retained in the artifact; 21 inherited affected packages. Expired exceptions unchanged. |

Test data is synthetic and paid APIs are mocked. Test nutrition is not a claim
about an actual egg, product or package label. Evidence is under ignored
`output/release/` and `output/playwright/`; do not publish the schema dump.

### Performance measurements

Lighthouse13.5.0, isolated signed-out Chromium, navigation audits on this machine:

| Target | Performance | Accessibility | Best practices | SEO | LCP | CLS | TBT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Existing live site, mobile |37 |89 |96 |82 |10.45s |0 |769ms |
| Existing live site, desktop |88 |89 |96 |82 |1.87s |0 |149ms |
| Local branch export, mobile before final sign-in fixes |79 |100 |96 |66 |3.75s |0 |321ms |
| Local branch export, mobile after fixes |79 |100 |100 |66 |3.75s |0 |310ms |

These are lab measurements, not field guarantees or a controlled live-vs-local
comparison. The local server does not use CDN compression; the first live mobile
run overlapped other verification work. The local SEO score includes deliberate
draft-policy noindex; do not enable indexing merely to improve the score.
Lighthouse surfaced the logo/name issues fixed above. Large Expo entry/common
chunks and global feedback CSS remain performance costs. The2s mobile LCP/95+
budget is not yet met. INP requires real interaction/field measurement; it is
not inferred from TBT or a navigation score. Reports are retained under
`output/release/lighthouse-*.json`.

**19 October web optimization:** the platform-specific calorie ring reduces the
entry from 2,893,558 to 2,054,444 raw bytes (29.0%) and estimated gzip from
709,696 to 552,423 bytes (22.2%). Native retains the original renderer. All seven
browser suites pass, including confirmed-food dashboard refresh at three widths.
Fresh serial Lighthouse medians were 39→41 performance and 20.07→15.63s LCP,
but every run warned of a slower-than-expected CPU on this memory-constrained
workstation. These are separate constrained diagnostics, not comparable to the
earlier 79-point run or proof of production speed. The budget remains unmet;
[details and recovery](2026-10-19-web-performance.md).

## Exact remaining setup and rollout

1. Remediate the two high advisories with a verified compatible patch or reviewed
   replacement. Current npm versions remain braces 3.0.3 and node-forge 1.4.0;
   [both](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
   [advisories](https://github.com/advisories/GHSA-86w9-cpqp-85rv) list no published
   fix. Do not suppress the gate, relabel versions or force a framework upgrade.
2. Provide isolated Supabase/Vercel project identities and hosting credentials
   through protected environments, following [CI setup](../CI_CD.md). Production
   mappings are now configured; follow the [Vercel token step](2026-10-19-release-connection.md#next-operator-step-vercel-ci-token).
   Staging identities and Supabase deployment credentials still need setup.
   Verify existing EAS ownership/configuration and the iOS application identity.
   Do not invent staging identities or create a paid project without a decision.
3. Finalize the actual legal operator, verified privacy/support email, age,
   deletion/backups/log retention, regional processing and payment/refund terms.
   Review DeepSeek's data use before setting its privacy flag. Optional analytics
   stays off until its provider/retention/cost decision is complete.
4. Follow [server configuration and rollout](../deepseek-label-photos.md): keep
   API/service-role keys server-only; review `supabase db push --dry-run --linked`,
   apply the 15 existing migrations in filename order, then deploy all seven
   functions **before** publishing the updated client. Rehearse against the
   isolated project first. Do not mark migrations applied without executing them.
5. Configure Auth SMTP and verified sender DNS, recovery email template,
   CAPTCHA/rate limits, retention/billing scheduler and spend alerts. Configure
   sandbox products/webhooks/store credentials before any paid release.
6. Run the live walkthrough below. Only then run the protected staged release,
   same-commit production release and real-device binary checks. Keep legal and
   analytics flags conservative; a secret existing by name is not verification.

### Live web/mobile walkthrough still required

Use controlled operator test accounts, not existing customer histories:

- Inspect a live 72 g boiled-egg source/basis; revise to100 g and egg whites,
  cancel, then confirm/retry on two devices and verify exactly one diary row and
  immediate totals. Ask an incomplete Fudgee Barr question; search-only text
  must remain answer-only. Inspect actual source matches and citations.
- Save/edit/delete/recall a preference, reload web/native, clear chat, switch
  account and verify no leakage. Review/correct/backdate a weight; confirm once,
  check history and synchronized current weight without target changes.
- Take/choose a real label photo, grant/deny camera permission, explicitly read,
  correct the extracted values and portion, cancel and retry failures. Confirm
  once; missing macros or conversion evidence must not become invented zeros.
- Exercise keyboard/safe area, VoiceOver/TalkBack, links and file sharing on a
  native binary. Test offline/save failure, Manila midnight and a DST timezone.
- Verify Gmail recovery delivery, sandbox purchase/restore/refund lifecycle,
  Basic/no-provider behavior and paid-plan limits before activating billing.
- Rerun live HTTPS/security headers, legal/deep links, real 404, social previews,
  crawlers and mobile/desktop Lighthouse after the reviewed client is deployed.

## Security review and recovery

**Security check:** reviewed input/body/time bounds, exact-origin credentials,
manual redirects, head-only metadata, trusted-build asset hashes, real JWT/API
denial, owner RLS/RPC scoping and transactional confirmation. No write boundary
was changed; model/page/memory text cannot confirm an action. No new dependency,
secret exposure, paid request or real-user mutation was introduced. Two existing
high advisories remain open, and live provider/device/operational checks remain
unverified. This is not a production security certification.

The 19 October independent reviews found no critical/high issue in the inspected
Bee write boundaries. The confirmed P2 retry defect is fixed and regression
tested. Audit reporting remains conservative on invalid policy. The public USDA
hosting-variable finding and its limited exposure check remain qualified as
described in the hosting supplement. A separate history scan confirmed an old
hardcoded USDA credential; [rotation is required](2026-10-19-secret-history-review.md).
Its value is absent from current tracked/web files, but no clean historical
credential audit is claimed. No data schema or write permission changed.

Revert this focused commit and reinstall the corresponding lockfile if needed;
this pass changes no database schema. Preserve additive deployed tables and all
user records. Disable Bee/label/search flags to recover provider failures rather
than deleting data. Previous GitHub `main` protection was absent; environment
branch policies were unrestricted. If an operator intentionally restores those
settings, the required CI protection is lost; that is not a secure rollback.

## Twenty-item launch evidence

“Implemented” means branch implementation plus local evidence. “Partial” includes
any missing real deployment, legal or native proof; it does not mean launched.

| # | Status | Evidence | Exact remaining operator action |
| --- | --- | --- | --- |
| 1 Privacy | Partial | Public/native route; current DeepSeek/photo/control draft; local export/browser | Approve operator/contact, rights/retention/deletion; deploy actual page; native walkthrough. |
| 2 Terms | Partial | Updated DeepSeek/label limitations, public route and local browser checks | Approve age/refund/dispute/effective date; deploy; native walkthrough. |
| 3 Secrets/access | Partial | Current files/bundles checked; RLS/owner tests; public USDA setting removed; history scan found an old hardcoded USDA credential | Revoke/replace the exposed USDA key, verify server-only lookup, configure protected deployment secrets and verify new deployed policies. Historical/lazy hosted assets remain unaudited. |
| 4 HTTPS | Partial | Live HTTP308, working TLS and Vercel HSTS verified; branch headers | Deploy configured app headers; recheck camera and all release URLs. |
| 5 Consent | Implemented | Consent/DNT/GPC/revocation tests; analytics off by default | Review optional provider before enabling; native tracking remains off. |
| 6 Metadata | Partial | Actual branch HTML and strengthened smoke pass; current live metadata incomplete | Deploy reviewed-origin HTML; rerun smoke and crawler checks. |
| 7 Social preview | Partial | Valid1200×630 asset, trusted-build hash/metadata checks; live asset404 | Deploy asset and inspect actual sharing previews. |
| 8 Favicon | Existing and verified | Expo icon preserved, fresh export/browser and exact-byte smoke | Inspect final native store artwork and deployed tab icon. |
| 9 Sitemap/robots | Partial | Exact public-only/draft policy checked; live files404 | Finalize legal approval, deploy generated files, verify direct URLs. |
| 10 Accessibility | Partial | Semantic controls, public keyboard and three-width browser tests | Full native VoiceOver/TalkBack and interactive device walkthrough. |
| 11 Images | Implemented | Existing lossless optimization retained; real artwork bundled in fresh exports | Inspect final native store artwork separately. |
| 12 Speed | Partial | Entry JS reduced 29.0%; accessible web ring and confirmed-food refresh verified; constrained serial Lighthouse / earlier live measurements documented | Meet remaining budget; remeasure deployed candidate on an isolated runner and native startup; obtain field INP. |
| 13 Contrast | Implemented | Existing37 contrast assertions pass in full suite | Verify native rendering and focus during device walkthrough. |
| 14 Mobile friendly | Partial | Seven browser suites at 375/768/1440; both native exports | Test a signed native binary on a physical device, camera/keyboard/account continuity. |
| 15 Custom404 | Partial | Branch branded404/export and smoke reject status200; live unknown URL200 | Deploy clean URLs/custom404; verify actual known and unknown status. |
| 16 Links | Partial | Export anchor validation and safe citation URLs; live legal URLs currently app shell | Verify deployed legal/support/source/native deep links. |
| 17 Validation | Implemented | Forms/label/food/weight/date/goal guards and real SQL tests | Review invalid legacy data before validating/applying constraints. |
| 18 Spam/quotas | Partial | Atomic budgets/JWT tests; old live APIs deny anonymous401; main CI gate applied | Configure Auth CAPTCHA/SMTP/limits, provider alerts, retention and billing schedules; deploy new APIs. |
| 19 Analytics | Partial | Sanitized consent-gated web adapter/tests; disabled | Approve provider/cost/retention/reporting; decide native strategy. |
| 20 Clear CTA | Implemented | Signed-out entry, reviewed tracking actions and adaptive suggestions tested | Final first/returning user walkthrough on deployed web and native. |
