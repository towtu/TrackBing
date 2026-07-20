# Quiet Dark UI Refresh — Design

**Date:** 2026-07-20
**Status:** Approved (direction + mockups reviewed by user)
**Mockups:** https://claude.ai/code/artifact/80481f72-8492-4a66-a5b1-b691f5157836

## Problem

The current UI reads as generic AI-generated ("vibecoded") dark mode: glow
shadows on the yellow accent, `fontWeight: "900"` throughout, uppercase
micro-labels with wide letter-spacing, neon macro colors (red / orange /
electric blue), bento tiles, and per-file invented radii (7–32). The user wants
a whole-app visual refresh.

## Direction: Quiet Dark

Keep the dark theme and all screen layouts, but calm the surface. Warm
near-black ground, one honey-gold accent used sparingly (calorie ring, primary
CTA/FAB, the Bee), muted earthy macro colors, border-only cards, restrained
type. System font stays — no new dependencies.

Three dashboard components also get a layout redesign (hero, macro tiles,
timeline); everything else is a token-and-type sweep.

## 1. Tokens — `src/styles/colors.ts`

Same export shape (`Colors` object, same key names) so all imports keep
working. New values:

| Token           | Old                  | New                          |
| --------------- | -------------------- | ---------------------------- |
| `primary` (bg)  | `#09090b`            | `#0e0d0b` warm near-black    |
| `secondary`     | `#121214`            | `#12100c`                    |
| `surface`       | `#18181b`            | `#16140f`                    |
| `surfaceHover`  | `#27272a`            | `#1f1c15`                    |
| `accent`        | `#ffcc00`            | `#e8b93c` honey gold         |
| `accentGlow`    | yellow 15%           | `rgba(232,185,60,0.12)`      |
| `accentDim`     | yellow 10%           | `rgba(232,185,60,0.10)`      |
| `text`          | `#ffffff`            | `#f0ede6` warm off-white     |
| `textSecondary` | `#a1a1aa`            | `#9b958a`                    |
| `textMuted`     | `#a1a1aa`            | `#9b958a`                    |
| `border`        | `#27272a`            | `#262218`                    |
| `borderLight`   | white 5%             | `#1f1c15` (hairline)         |
| `inputBg`       | `#121214`            | `#12100c`                    |
| `accentBlue`    | `#6E88B0`            | `#76869e` desaturated slate  |
| `error`         | `#ef4444`            | `#b5544a`                    |
| `success`       | `#4ADE80`            | `#7da26e`                    |
| `protein`       | `#ff4d4d` neon red   | `#c96b5a` clay               |
| `carbs`         | `#ffaa00` orange     | `#d0a24f` wheat              |
| `fat`           | `#00d0ff` neon blue  | `#8fa87e` sage               |

Add to the same file (new exports, additive only):

```ts
export const Radii = { card: 14, inner: 10, pill: 999 };
```

Any other one-off colors found in components (e.g. `#FF6B35` sidebar streak
orange, raw `#000` on-accent text) are replaced with tokens; `#FF6B35` is
removed entirely (streak uses `accent`).

## 2. Typography rules (applied everywhere in the sweep)

- Max `fontWeight: "700"`. Stat numbers `"600"`, labels `"500"`, body
  `"400"`–`"500"`. No `"800"`/`"900"` anywhere.
- Remove every `textTransform: "uppercase"` + `letterSpacing >= 1` micro-label;
  replace with normal-case 12–13px `textSecondary` text.
- `fontVariant: ["tabular-nums"]` on all numeric stat text (ring values, macro
  values, kcal figures).
- Negative letter-spacing only on the hero calorie number (max −1).
- System font stack unchanged.

## 3. Surface rules (applied everywhere in the sweep)

- No glow shadows: delete every `shadowColor: Colors.accent` /
  colored-shadow style. No decorative black mega-shadows either
  (`shadowOpacity >= 0.3`); cards are flat with 1px `border` /
  `borderLight` hairlines. Native `elevation` capped at 2 where a modal/FAB
  genuinely floats.
- Radii from `Radii`: cards 14, inner elements 10, true pills 999. No more
  20/22/24/32 one-offs.
- Decorative background blobs / tinted icon bubbles removed unless they carry
  meaning.

## 4. Dashboard targeted redesigns (`src/screens/DashboardScreen.tsx`)

Both the mobile and `isDesktop` render branches:

- **Hero:** plain date text ("Today, July 20" — "Today," in `textSecondary`),
  streak as inline text (`6-day streak`, count in accent) — the date pill and
  glowing fire badge are deleted. One clean ring (stroke ~9, honey on
  `border`-colored track, no glow filter), centered kcal-left number (40–44px,
  weight 600, tabular), "kcal left" in lowercase secondary text, "Goal 2,000 ·
  Eaten 716" line below.
- **Macros:** the 3 bento tiles become one segmented row card (three cells
  divided by hairlines): label, `62 / 150 g` value, 3px progress bar in
  clay/wheat/sage. No icon bubbles, no corner blobs.
- **Timeline:** flat list rows — 6px plain accent dot, food name (14.5px/600),
  macro line in muted clay/wheat/sage, right-aligned kcal figure; hairline
  row dividers instead of shadowed cards. Header "Today's log" + "N items" as
  plain secondary text (no badge).

## 5. Desktop mode (web ≥ 1024px)

`useResponsive` breakpoint and 1200px content max-width unchanged.

- **`DesktopSidebar.tsx` restyle (no layout change):** brand weight 650;
  orange streak panel → quiet text line ("6-day streak", count in accent);
  nav items radius 10, weight 500, active = `accentDim` background +
  accent-colored label (no border, no icon bubble); footer avatar becomes
  neutral (`border` bg, accent letter); logout becomes a plain row —
  neutral text, error color reserved for hover/icon only.
- **Dashboard desktop branch:** applies the same hero/macro/timeline redesign,
  arranged as ring + stacked macro card in a ~320px left column, log panel
  filling the right.
- All other screens' desktop branches get the same token sweep; hover states
  use `surfaceHover`.

## 6. Sweep scope (token/type/surface rules only, no layout changes)

`app/(tabs)/add.tsx`, `stats.tsx`, `cookbook.tsx`, `profile.tsx`,
`app/scan.tsx`, `my-foods.tsx`, `create-food.tsx`, `create-recipe.tsx`,
`auth.tsx`, `src/screens/AuthScreen.tsx`, `ProfileScreen.tsx`,
`src/components/ai/*` (AiFoodSheet, BeeQuickLog, BeeGuide, AiEstimateBadge),
`src/components/nutrition/*`, `src/components/feedback/SweetFeedback.tsx`,
`src/components/DesktopSidebar.tsx`, tab bar in `app/(tabs)/_layout.tsx`.

Charts in `stats.tsx` adopt the new macro colors.

## Error handling / edge cases

- Contrast: `textSecondary #9b958a` on `#16140f` ≈ 4.9:1 — passes AA for the
  small-label sizes used. Honey `#e8b93c` is decorative/large-text only;
  text on accent stays black (`textOnAccent`).
- Macro colors must remain distinguishable in the stats charts — verified
  visually at 375px.
- Streak = 0 and empty-log states keep their current copy, restyled.

## Testing / verification

- `npm run typecheck`, `npm test`, `npm run lint` — all green.
- Playwright on Expo web: screenshot every screen at 375 / 768 / 1440px,
  check console errors and failed requests, drive the FAB menu, edit-goal
  modal, and AI food sheet before/after.
- Grep gates after the sweep: no `fontWeight: "800"|"900"`, no
  `textTransform: "uppercase"` outside intentional cases, no `#ffcc00` /
  `#ff4d4d` / `#ffaa00` / `#00d0ff` / `#FF6B35` anywhere.

## Out of scope

- No layout changes outside the three dashboard components + desktop dashboard
  arrangement.
- No new fonts or dependencies.
- No light theme.
- Bee mascot artwork unchanged.
