# Web dashboard progress — 19 October 2026

## Change

The dashboard's simple calorie ring previously brought the native animation
runtime into the shared web app entry. `CalorieProgress.web.tsx` now renders a small SVG;
`CalorieProgress.tsx` retains the existing native renderer and all its props.
Expo selects the implementation for each platform. No dependency was added and
native animation packages remain available to the native app.

The web ring keeps the 130px surface, existing colors, 148-unit viewBox,
69.5-unit radius and 9-unit stroke. It starts at the top and fills clockwise.
Its arc fills at the target; accessible text still reports actual intake when
over target. Invalid values expose unknown progress without invalid numeric
ARIA/SVG attributes. The web arc updates directly without a fill animation.
Nutrition, target calculations and database writes were not changed.

## Measured JavaScript

Retained baseline export compared with the current finalized export. Byte counts
are actual files; gzip is an offline level-9 estimate, not measured CDN transfer.

| Asset measure | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Entry JS, raw | 2,893,558 B | 2,054,450 B | 29.0% |
| Entry JS, gzip | 709,696 B | 549,735 B | 22.5% |
| Three initial HTML script assets, raw | 3,404,855 B | 2,565,455 B | 24.7% |
| Three initial HTML script assets, gzip | 837,481 B | 677,271 B | 19.1% |

A separate source-map export confirms no Reanimated, Redash or Worklets modules
in the new web entry graph. The initial route still loads a 507KB common chunk;
these savings do not meet the 100KB JavaScript budget. A representative new
signed-out Lighthouse navigation transferred 2,715,502 bytes over seven local
requests without CDN compression; its logo image was 71,816 bytes. These are
lab/export measurements, not production transfer guarantees.

## Browser evidence

All seven controlled suites passed at 375/768/1440. The dashboard assertions
verify its real target and empty progress, then review/cancel and confirm a
synthetic food. Only confirmation changes the ring after the existing food-log
event and authoritative refetch. The `111.6` fixture value is illustrative
**TEST DATA**, not a real nutrition claim. The fixture now issues a unique ID
and review version on every egg proposal, so cancelled reviews stay inactive.

Screenshots at all three widths were visually inspected. No unexpected console
errors or failed requests occurred. This remains mocked web verification, not
signed native/device or live provider proof.

Node 24.21.0 checks also passed: TypeScript, ESLint, 944 tests across 63 files
(including eight rendered-ring tests), finalized 23-route web export and both
iOS/Android Hermes exports. Separate backend/database evidence remains in the
[launch report](2026-10-18-release-readiness.md); no backend code changed in
this performance increment.

## Lighthouse limits

Lighthouse 13.5.0, bundled Playwright Chromium, Node 24.21.0; three alternating
before/after mobile runs on the same loopback server, without overlapping export
or browser-suite jobs. Default simulated mobile throttling, fresh browser state.
Lighthouse used the preceding equivalent-source export; the byte table above
records the final Node 24 rebuild, whose minified output differs slightly.

| Median of three runs | Before | After |
| --- | ---: | ---: |
| Performance | 39 | 41 |
| LCP | 20.07s | 15.63s |
| Total blocking time | 2,167ms | 1,959ms |
| CLS | 0 | 0 |
| Accessibility / best practices | 100 / 100 | 100 / 100 |

**Every run warned that this machine's CPU was slower than Lighthouse expects.**
The workstation also had severe memory pressure. Treat these as constrained lab
diagnostics; do not compare them to the earlier 79-point run as a regression or
present the difference as a production improvement. The byte savings are
deterministic; the speed target remains unmet. Recheck a deployed candidate on
an isolated runner with real compression. INP and native startup remain
unmeasured; navigation TBT does not establish INP. SEO remains limited by draft
policy/noindex and was not an optimization target.

Ignored evidence: `output/release/profile-web/`,
`output/release/progress-web/`, `output/release/setup/lighthouse-progress-*.json`,
`output/release/setup/browser-progress.log` and
`output/playwright/adaptive-launch/dashboard-confirmed-food-*.png`.

## Recovery

Revert this focused performance commit to restore the previous dashboard
renderer. No migration, secret, stored food or target needs changing. Keep the
native packages while the native renderer uses them. Release stays blocked by
the separately documented dependency advisories and credential recovery.
