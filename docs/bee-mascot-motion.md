# One moving, user-aware Bee

Implemented on `feat/bee-conversation`. This follow-up changes the shared Expo
client; it adds no provider secrets, dependencies, database migration or write
permission. Production publication and a native device walkthrough remain separate.

## Behavior

- The dashboard has a larger 116 px full-body Bee beside its daily guidance,
  with an accessible “Ask Bee” button and a tappable mascot. It has no duplicate
  floating Bee. A bottom-right chat icon opens the same conversation and stays
  above mobile navigation. It hides while chat, the keyboard or a library sheet
  is open. Other routes retain the compact shared chat launcher; page
  guidance uses text rather than repeating artwork. The plans page no longer
  repeats an unrelated greeting image.
- Opening chat hides the dashboard artwork and moves Bee into its fixed header. The transcript and welcome state
  do not duplicate it. Long food reviews can scroll without losing the companion.
- The companion uses the current account's saved targets, today's actual diary and
  the presence of a real weigh-in today. Missing data stays neutral; a profile
  baseline is not a dated measurement. Empty diaries do not imply someone has
  not eaten. Going over a target uses a calm resting pose, without a warning or
  instruction to restrict food. A ratio within 90–110% uses acknowledgement;
  these thresholds are visual choices, not health assessments.
- Protein ideas use the existing encouraging pose; a fat-target review uses
  thinking. Both show readable recorded grams and the actual saved target. No
  macro target is filled from a default. Protein ideas require at least two
  entries, recorded calories at least half of the saved target, and protein
  target progress below 60% of calorie target progress. A fat review appears
  above 110% of the saved fat target and takes priority. These are optional UI
  cues, not claims about health, whole-day intake or meal categories; they never
  prescribe restriction or assume that missing logs mean missing meals.
- Pending food, weight and goal reviews use thinking. The header follows the
  current validated assistant pose after a reply. Generic semantic poses do not
  claim a streak, dietary deficit, inactivity or provider failure.
- A server-confirmed food/weight/goal outcome triggers a brief acknowledgement;
  asking a question or reviewing a proposal does not celebrate a saved entry.
- The existing eight illustrations move with distinct gentle hover/tilt rhythms.
  Art moves up to 3 px horizontally, 5 px vertically and 3 degrees, inside the
  reserved space. The launcher hit target stays anchored; Bee does not roam over
  controls. These are animated illustrations, not newly generated frame-by-frame
  wing animations.
- “Pause Bee motion” / “Animate Bee” in chat controls the device preference.
  System reduced-motion settings always override animation. Movement also stops
  when the app/tab is in the background, the dashboard loses navigation focus,
  artwork leaves the web viewport, or the
  chat composer is focused. The launcher hides while forms have focus/on-screen
  native keyboards, including fields that autofocus before listeners attach.

## Ownership, freshness and cost

`BeeCompanionProvider` is keyed by the signed-in account. It uses the existing
account guard to validate the user and pin reads to that account's token. Every
query includes `user_id`; existing owner-only RLS remains authoritative. The
context clears on sign-out/account change. In-flight results from a disposed
account are ignored. Neither context nor conversations are stored in the device
motion preference (`trackbing:bee-motion`), which contains only enabled/paused.

Only the saved timezone/calorie/protein/fat targets, up to 250 current-day
calorie/protein/fat fields and one
current-day non-baseline weigh-in flag are read. Day boundaries use the saved
IANA timezone through `accountDay`. Weight amounts, names, chat text and memories
are unnecessary for the companion and are not read for it. Capped, non-finite,
negative or missing totals remain unknown per nutrient. They cannot trigger a
cue for that nutrient or signal a completed target.

Reads refresh on food/weight/profile change events, foreground resume and the
local-day boundary (checked once a minute while active). Overlapping refreshes
are coalesced and superseded results are discarded. Context is local to the
mounted account, not a shared nutrition cache. Other-device changes refresh on
resume/reload; this follow-up adds no realtime subscription.

Animation, pose selection and mascot taps make no paid model/Search call. Taps
open the existing conversation loader. Existing dashboard insights and message
requests retain their server quotas and provider behavior. SQL confirmations and
food/weight/goal payload validation are unchanged; visual state cannot authorize
any database write.

React Native's existing [Animated](https://reactnative.dev/docs/animated),
[AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo) and
[AppState](https://reactnative.dev/docs/appstate) APIs handle native transforms,
OS preferences and lifecycle. Animations use `isInteraction: false` so continuous
motion does not hold native list rendering open; only transforms/opacity animate.

## Verification

All nutrition/account examples below are clearly marked TEST DATA. Browser
checks intercept authentication, database and provider calls; no real diary is
changed and no paid provider is contacted.

- `npm run typecheck`, `npm run lint`, `npm test`.
- `npm run build:web` (23 routes and export checks).
- `npx expo export --platform ios --platform android --output-dir output/native-bee-motion`.
- `node scripts/check-secrets.mjs --dist`.
- `node scripts/check-bee-motion.cjs` with a separately available Playwright
  module/Chromium, optionally `PLAYWRIGHT_MODULE`, `CHROME_BIN`, `UI_BASE_URL`.
  Without `UI_BASE_URL`, the script starts/stops an isolated export server.
- `node scripts/check-web-ui.cjs` against the local export checks existing
  corrections, source attribution, memories and confirmation flows.

Motion checks cover 375/768/1440 px, one companion, actual context fixtures,
confirmed-save acknowledgement, changing OS reduced motion, background pause,
device pause/reload, focused forms, cross-account switching/sign-out, owner-scoped
reads, unavailable context and no model calls during movement. Screenshots are
in ignored `output/playwright/bee-motion/`. The broader browser checks include
public routes, protected routes, food/weight reviews and Google attribution.

A native Hermes export proves compilation, not VoiceOver/TalkBack, keyboard or
physical-device animation behavior. Before release, use one test account on
Expo/native and web: observe idle movement, review/cancel/save a serving, record
a weight, pause/resume motion, enable OS reduced motion, background/resume,
change accounts and inspect narrow keyboard layouts. Existing Gemini billing,
backend setup, provider terms, legal review and deployment requirements remain
in [the deployment guide](bee-gemini-deployment.md).

### Recorded local results

- 47 suites / 635 tests passed; typecheck and lint passed.
- Web export and iOS/Android Hermes exports passed.
- New motion and existing Bee browser walkthroughs passed at all three widths,
  including dashboard placement, actual image-source changes, protein/fat/unknown
  macro fixtures, account switch and sign-out. No
  unexpected console errors or failed requests; the scanner's mocked camera
  denial is expected in the broader walkthrough.
- Tracked/export secret-pattern scan passed (not an exhaustive credential audit).
- `npm audit` reports 16 existing advisories: 1 high, 15 moderate, 0 critical.
  No dependencies changed; the known compatible Expo/Metro dependency review
  remains separate from this UI change.
- Security review: bounded reads, validated/pinned account tokens, owner filters,
  unchanged RLS/RPC/write boundary, account cleanup, unknown-value handling,
  no sensitive context persistence/logs, no injected HTML and no paid calls from
  animation. User-owned `codex.diff` was preserved.

## Requested food-themed artwork: remaining limitation

The new meat/protein, nutrition-review and meal-planning illustrations are not
implemented. The built-in image-generation service rejected both the detailed
reference-based request and a simplified protein-plate request with
`moderation_blocked` (output stage, category `other`), without a specific
explanation. No image was returned or added, and no CLI/provider substitution
was made. The working dashboard and nutrient cues use the original eight
illustrations. Supplying approved matching transparent artwork or restoring the
image-generation capability is the next step for new illustrated poses.

Reference: `assets/images/bee/bee-greeting.png`. Built-in tool was used; no
workspace asset was generated. The simplified final attempted prompt was:

> Create a sibling pose of this friendly illustrated bee for a nutrition app.
> Keep the reference bee's face, golden fur, black stripes, wings, antennae and
> crossbody bag. Full body, centered square image, transparent background. The
> smiling bee holds a small dinner plate with cooked chicken, beans and tofu.
> Soft 3D illustration matching the reference. No text or backdrop. Keep every
> wing and antenna inside the image.

Manual walkthrough for this follow-up: sign in on web and a native device,
check that Bee sits in the dashboard guide rather than floating over the diary,
tap Bee/Ask Bee, close chat, verify a current proposal's thinking pose and a
confirmed save's acknowledgement, pause/reload motion, and navigate to another
tab. With controlled owned logs and saved macro targets, inspect the factual
protein/fat cue; unknown macros must not produce a cue. Physical-device
verification remains outstanding; web/browser and native-export results above
do not establish it.
