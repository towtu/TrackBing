# TrackBing Bee Companion Redesign

**Date:** 2026-07-29

**Status:** Draft for user review

**Branch:** `feat/ai-macros`

## Summary

Replace TrackBing's tall, muscular Bee artwork with a smaller, rounder, original
companion inspired by the interaction patterns in the supplied tarsier and bird
references. Bee will use eight consistent poses across dashboard coaching,
Quick Log, AI food sheets, Add Food, Create Food, and selected empty states.

The same change will make the dashboard's daily calorie target read-only.
TrackBing's existing profile/TDEE calculation remains the source of truth;
users will no longer be able to type a calorie override from the dashboard.

## Goals

- Give Bee a recognizable, original silhouette and personality.
- Use pose changes to communicate state, not decoration.
- Make Bee state-reactive and tappable without triggering data writes or AI
  requests.
- Keep one consistent Bee system across all existing Bee surfaces.
- Preserve the quiet-dark TrackBing visual system and responsive layouts.
- Remove only obsolete, unreferenced muscular Bee assets.
- Remove the dashboard's direct calorie-target editor while preserving the
  existing nutrition calculation and stored values.

## Non-goals

- Copying the tarsier or bird characters, outfits, or exact layouts.
- Adding a new animation, illustration, or icon dependency.
- Changing the nutrition-target formula, macro formula, database schema, or
  Supabase policies.
- Automatically rewriting legacy custom calorie values.
- Turning every empty state into a mascot scene.
- Adding voice, sound effects, or an open-ended chatbot personality.

## Threat model

TrackBing stores private body measurements, goals, and food logs. The worst
failure in this scope is showing or saving an incorrect calorie target, or
letting a visual interaction mutate nutrition data unexpectedly. Bee taps will
therefore remain local presentation state only. The existing tested nutrition
calculation remains authoritative, the dashboard's alternate custom-calorie
write path is removed, and all existing Supabase owner-scoped queries and RLS
requirements remain unchanged. Generated mascot assets contain no user data and
will be bundled locally.

## Visual identity

Bee becomes a compact companion rather than a human-sized fitness character:

- Large expressive head and warm brown eyes.
- Small striped body, short limbs, soft antennae, and translucent leaf-shaped
  wings.
- Honey-gold and charcoal base colors with restrained moss accents from the
  current palette.
- A small crossbody food-log pouch with a subtle honeycomb mark.
- One consistent outfit, body shape, eye color, markings, and rendering style
  across every pose.
- Polished storybook-style 3D illustration with clean transparent edges.
- No muscular anatomy, gym clothing, oversized sneakers, text, watermark, or
  resemblance to the supplied reference characters.

Bee must remain legible at the smallest chat-avatar size. Props should be bold
and simple rather than finely detailed.

## Pose set

The project will contain exactly eight final Bee pose assets:

1. `greeting` — small wave; friendly neutral state.
2. `thinking` — checking the food-log notebook.
3. `encouraging` — pointing toward the next action.
4. `celebrating` — mid-hover with raised arms.
5. `caution` — gentle concerned expression, never scolding.
6. `resting` — sleepy or returning after inactivity.
7. `searching` — inspecting a food label with a magnifying glass.
8. `success` — holding a checked food-log card.

The assets will live under `assets/images/bee/` with stable descriptive
filenames. They will be generated as a consistent character family, converted
to transparent PNGs, inspected at full size and thumbnail size, and optimized
before use.

## Situation model

Screens select a semantic situation; they do not import image filenames.

| Situation | Pose | Typical surface |
| --- | --- | --- |
| `greeting` | greeting | dashboard greeting, time-based greeting |
| `emptyDay` | encouraging | no meals logged |
| `firstMeal` | success | first successful meal log |
| `searching` | searching | AI or web food lookup |
| `needsClarification` | thinking | Quick Log follow-up question |
| `reviewingMatch` | thinking | food found and awaiting confirmation |
| `logSuccess` | success | successful food save/log |
| `streak` | celebrating | streak or milestone |
| `lowProtein` | encouraging | protein coaching |
| `underTarget` | encouraging | remaining calorie room |
| `nearTarget` | success | target zone |
| `overTarget` | caution | gentle over-target note |
| `inactiveReturn` | resting | return after a week or month |
| `lookupError` | caution | unavailable or failed AI lookup |
| `barcodeFound` | success | successful barcode result |
| `barcodeNotFound` | thinking | barcode needs manual help |
| `emptyCollection` | encouraging | empty Cookbook or food history |

Future situations must map to an existing pose unless a genuinely new
communication need justifies another asset.

## Components and boundaries

### Pure situation mapping

A small pure module will define:

- `BeeSituation`
- `BeePose`
- situation-to-pose mapping
- accessibility labels
- short, prewritten tap reactions

This module has no React Native, Supabase, or network dependency and will have
unit tests.

### `BeeMascot`

`BeeMascot` owns:

- resolving the pose asset from a semantic situation
- small, medium, and large sizing
- press feedback and one short bounce
- reduced-motion behavior
- accessibility role, label, and hint
- a safe greeting-pose fallback

Tapping Bee may rotate to another message already supplied by the parent, but
must never save data, open a network request, or consume an AI credit.

### `BeeGuide`

`BeeGuide` becomes one integrated companion panel with three variants:

- `dashboard` — Bee overlaps the card edge and has the most visual presence
- `compact` — Add/Create Food and AI sheet guidance
- `chat` — small Bee portrait associated with Bee messages

At most one prominent Bee appears in a view. The dashboard is the only surface
that uses the large companion treatment.

### Screen integration

- **Dashboard:** uses nutrition and streak state to choose a situation.
- **Quick Log:** switches between greeting, searching, clarification, review,
  success, and error situations as the conversation progresses.
- **AI food sheet:** uses compact searching, review, and error states.
- **Add/Create Food:** uses compact encouraging/searching/review states.
- **Empty states:** only high-value empty logs, Cookbook, or history surfaces
  receive Bee.

Existing Bee coaching copy remains deterministic and local. New tap reactions
are short, supportive, and never shame users for eating or missing logs.

## Interaction and motion

- Press feedback: approximately 100–120 ms scale-down.
- Bounce response: approximately 220–280 ms spring return using the existing
  React Native animation APIs.
- Pose change: short opacity crossfade when the situation changes.
- Loading: subtle hover or bob using transform only; no continuous animation
  on every Bee instance.
- Repeated taps: one playful alternate line after several taps, followed by a
  cooldown.
- Reduced motion: immediate pose/message changes with no bounce, hover, or
  crossfade.

Animations use transforms and opacity only. GSAP is not appropriate for this
Expo/React Native interaction and no new dependency is needed.

## Dashboard calorie target

The dashboard's direct calorie-target editor will be removed:

- Remove the pencil/edit affordance beside `Daily target`.
- Remove the custom target modal, input state, validation, and save handler
  from `DashboardScreen`.
- Render the target as a read-only value with helper copy such as
  `Calculated from your profile`.
- Provide a route to Profile for users who need to update the body statistics,
  activity level, or goal rate that feed the calculation.
- Do not create new `goal_mode = "custom_calories"` values from the dashboard.
- Continue reading the saved `calorie_target`, macro percentages, and macro
  grams from the user's `user_goals` row.
- Preserve legacy/custom stored targets until the user explicitly selects and
  saves a calculated plan in Profile; do not silently rewrite health settings.
- Leave the existing adult/minor calculation, calorie floors, rate caps, and
  macro recalculation unchanged.

This removes direct calorie entry while retaining the current calculation and
backward compatibility.

## Loading, errors, and fallbacks

- Missing or invalid situation values fall back to `greeting`.
- A failed image load must not block coaching text or actions.
- AI lookup failures select `lookupError` and continue using existing generic
  user-facing error copy.
- Loading interactions remain dismissible where they are currently
  dismissible; Bee animation cannot trap focus or block a close action.
- Tap reactions are disabled while a parent action is loading if they would
  compete with the active state.

## Accessibility

- Bee images receive contextual accessibility labels rather than filenames.
- Interactive Bee instances use button semantics and a clear hint.
- Decorative chat portraits are hidden from the accessibility tree when the
  same message is already announced.
- Focus and touch targets remain at least 44×44 logical pixels.
- Color is not the only signal; pose changes always accompany text.
- Reduced-motion preferences are respected on web and native platforms.
- Coaching copy avoids guilt, shame, or medical claims.

## Responsive behavior

- **375 px:** compact integrated dashboard panel; Bee may overlap the edge but
  cannot cover text or controls.
- **768 px:** panel expands horizontally and preserves readable line length.
- **1440 px:** dashboard Bee is larger, but the card remains subordinate to
  nutrition data.
- No mascot asset may cause horizontal scrolling or shift the bottom
  navigation/FAB.

## Asset cleanup

After all imports are migrated and verified, remove only:

- `assets/images/bee-power-empty.png`
- `assets/images/bee-power-inactive-month.png`
- `assets/images/bee-power-inactive-week.png`
- `assets/images/bee-power-low-protein.png`
- `assets/images/bee-power-over.png`
- `assets/images/bee-power-pose.png`
- `assets/images/bee-power-streak.png`
- `assets/images/bee-power-strong-protein.png`
- `assets/images/bee-power-under.png`

Before deletion, a repository-wide usage scan must return no references to
these files. TrackBing logos, icons, splash assets, unrelated images, and the
user's existing uncommitted tab changes remain untouched.

## Verification

Automated:

- Unit tests for every situation-to-pose mapping and fallback.
- Unit tests for tap-message selection/cooldown helpers where implemented as
  pure logic.
- Existing nutrition-target tests remain unchanged and passing.
- A regression check confirms the dashboard no longer exposes a custom
  calorie-target input or write path.
- `npm run typecheck`
- `npm test`
- `npm run lint`

Browser:

- Dashboard screenshots at 375 px, 768 px, and 1440 px.
- Quick Log before, during, and after an AI lookup.
- Tap Bee and confirm bounce/message behavior.
- Confirm reduced-motion behavior.
- Confirm no console errors or failed asset requests.
- Confirm no horizontal overflow and no covered controls.

Native-oriented manual checks:

- Touch targets and animation on a phone-sized Expo view.
- Modal/sheet close actions remain available.
- Bee images remain crisp on high-density screens.

## Acceptance criteria

- The old muscular Bee no longer appears anywhere.
- All eight final Bee assets clearly depict the same original character.
- Sixteen or more app situations map predictably to the eight poses.
- Bee changes pose automatically and responds safely to taps.
- Bee never triggers a write or AI request merely because it was tapped.
- The dashboard calorie target is read-only and labeled as calculated.
- Users can update calculation inputs through Profile, not enter dashboard
  calories directly.
- Legacy targets are not silently rewritten.
- Only confirmed obsolete Bee assets are deleted.
- Typecheck, tests, lint, responsive screenshots, console checks, and network
  checks pass.
