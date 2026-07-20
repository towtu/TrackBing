# Quiet Dark UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "vibecoded" dark UI with the approved Quiet Dark design — new tokens, calm typography, border-only surfaces, redesigned dashboard hero/macros/timeline, restyled desktop sidebar — per `docs/superpowers/specs/2026-07-20-quiet-dark-ui-refresh-design.md`.

**Architecture:** One token file (`src/styles/colors.ts`) drives most of the change; three dashboard components and the desktop sidebar get layout-level rework; every other styled file gets a mechanical sweep applying the Global Constraints below. Verification is grep gates + typecheck/test/lint + Playwright screenshots on Expo web.

**Tech Stack:** Expo / React Native (StyleSheet), expo-router, vitest, tsc, Playwright CLI against `npx expo start --web`.

## Global Constraints (apply to EVERY task)

Copy of the spec's sweep rules — every styled file must satisfy these:

- **Weights:** max `fontWeight: "700"`. Map `"900"`→`"700"` (brand/hero emphasis) or `"600"` (stat numbers); `"800"`→`"600"`; `"700"` labels→`"500"` or `"600"`. No `"800"`/`"900"` anywhere.
- **Micro-labels:** delete every `textTransform: "uppercase"` paired with `letterSpacing >= 1`; replace with normal-case 12–13px `Colors.textSecondary`, `fontWeight: "500"`, `letterSpacing: 0` (drop the key). Sentence-case the label copy in JSX ("CALORIES REMAINING" → "Calories remaining").
- **Numbers:** add `fontVariant: ["tabular-nums"]` to stat-number styles (ring values, macro values, kcal totals). Negative letterSpacing only on the hero calorie number, min `-1`.
- **Shadows:** delete every shadow style whose `shadowColor` is an accent/colored value, and every decorative shadow with `shadowOpacity >= 0.3`. Cards become flat: `borderWidth: 1`, `borderColor: Colors.border` (or `Colors.borderLight` for hairlines). `elevation` ≤ 2, only on things that genuinely float (FAB, modals, sheets).
- **Radii:** import `Radii` from `@/src/styles/colors` (or relative path matching the file's existing import style). Cards/sheets/modals → `Radii.card` (14), inner elements/buttons/inputs → `Radii.inner` (10), true pills/dots → `Radii.pill` (999) or half the element size. Delete one-off 16/18/20/22/24/32 values.
- **Raw colors:** no raw hex outside `colors.ts` except pure `#000`/`#fff` where genuinely needed (e.g. scrim). `#FF6B35` is banned — streaks use `Colors.accent`. Replace `rgba(255, 204, 0, …)` with `Colors.accentGlow`/`Colors.accentDim`. Replace `rgba(239, 68, 68, …)` tints with `Colors.error` at low opacity via existing pattern or a flat `Colors.surface` + error-colored text/icon.
- **Decoration:** remove decorative background blobs, tinted icon-bubble squares, and glow dots unless they carry meaning.
- **No layout changes** outside Task 2 (dashboard) and Task 3's sidebar-active-state simplification.
- **Commits:** author `towtu <fatowtu123@gmail.com>`, conventional messages, NO AI co-author trailers.
- After every task: `npm run typecheck` must pass. Commit per task.

---

### Task 1: Token file — `src/styles/colors.ts`

**Files:**
- Modify: `src/styles/colors.ts` (entire file below)

**Interfaces:**
- Produces: `Colors` (same keys as today, new values), new `Radii` export. All later tasks import these.

- [ ] **Step 1: Replace the file contents**

```ts
// src/styles/colors.ts
export const Colors = {
  primary: "#0e0d0b",
  secondary: "#12100c",
  surface: "#16140f",
  surfaceHover: "#1f1c15",
  accent: "#e8b93c",
  accentGlow: "rgba(232, 185, 60, 0.12)",
  accentDim: "rgba(232, 185, 60, 0.10)",
  accentBlue: "#76869e",
  textOnAccent: "#000000",
  text: "#f0ede6",
  textSecondary: "#9b958a",
  textMuted: "#9b958a",
  border: "#262218",
  borderLight: "#1f1c15",
  inputBg: "#12100c",

  error: "#b5544a",
  success: "#7da26e",
  white: "#ffffff",

  protein: "#c96b5a", // clay
  carbs: "#d0a24f",   // wheat
  fat: "#8fa87e",     // sage
};

export const Radii = {
  card: 14,
  inner: 10,
  pill: 999,
};
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → exit 0.
Run: `grep -n "ffcc00\|ff4d4d\|ffaa00\|00d0ff" src/styles/colors.ts` → no output.

- [ ] **Step 3: Commit**

```bash
git add src/styles/colors.ts
git commit -m "feat: quiet dark token palette and radii"
```

---

### Task 2: Dashboard redesign — `src/screens/DashboardScreen.tsx`

**Files:**
- Modify: `src/screens/DashboardScreen.tsx` (both the mobile and `isDesktop` render branches)

**Interfaces:**
- Consumes: `Colors`, `Radii` from Task 1.
- Produces: nothing consumed by later tasks (screen-local styles).

- [ ] **Step 1: Hero rework (both branches)**

Remove: the date pill (`datePill*` styles + JSX), the fire/streak badge (`fireBadge*` styles + JSX + glow shadow), the `heroSmallLabel` uppercase styles, hero card mega-shadow, ring glow shadows.

Replace header with plain text row (keep existing state/handlers intact):

```tsx
<View style={styles.headerRow}>
  <Text style={styles.dateText}>
    <Text style={styles.dateTextDim}>Today, </Text>{dateStr}
  </Text>
  {streak > 0 && (
    <Text style={styles.streakText}>
      <Text style={styles.streakCount}>{streak}-day</Text> streak
    </Text>
  )}
</View>
```

```ts
headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
dateText: { color: Colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.2 },
dateTextDim: { color: Colors.textSecondary, fontWeight: "400" },
streakText: { color: Colors.textSecondary, fontSize: 13 },
streakCount: { color: Colors.accent, fontWeight: "600" },
```

Hero card becomes flat (`backgroundColor: Colors.surface`, `borderWidth: 1`, `borderColor: Colors.border`, `borderRadius: Radii.card`, no shadow). `CircularProgress` props: `activeStrokeColor` `Colors.accent`, `inActiveStrokeColor` `Colors.border`, stroke width ~9, no glow. Center number: `fontSize: 42, fontWeight: "600", letterSpacing: -1, fontVariant: ["tabular-nums"]`; sub-label "kcal left" lowercase 13px `textSecondary`. Below the ring: `Goal 2,000 · Eaten 716` line — 13px `textSecondary`, values in `Colors.text` weight 600 tabular.

- [ ] **Step 2: Macro bento → segmented row (both branches)**

Delete `bento*`, `macroIconWrap`, blob styles and their JSX (icon bubbles, corner blobs). Replace the three tiles with one bordered row card:

```tsx
<View style={styles.macroRow}>
  {[
    { label: "Protein", value: totals.protein, goal: goals.p, color: Colors.protein },
    { label: "Carbs", value: totals.carbs, goal: goals.c, color: Colors.carbs },
    { label: "Fat", value: totals.fat, goal: goals.f, color: Colors.fat },
  ].map((m, i) => (
    <View key={m.label} style={[styles.macroCell, i > 0 && styles.macroCellDivider]}>
      <Text style={styles.macroLabel}>{m.label}</Text>
      <Text style={styles.macroValue}>
        {Math.round(m.value)}
        <Text style={styles.macroGoal}> / {m.goal} g</Text>
      </Text>
      <View style={styles.macroTrack}>
        <View style={[styles.macroFill, { width: `${Math.min(100, (m.value / m.goal) * 100)}%`, backgroundColor: m.color }]} />
      </View>
    </View>
  ))}
</View>
```

```ts
macroRow: { flexDirection: "row", backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.card, overflow: "hidden", marginTop: 14 },
macroCell: { flex: 1, paddingVertical: 14, paddingHorizontal: 14 },
macroCellDivider: { borderLeftWidth: 1, borderLeftColor: Colors.border },
macroLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: "500" },
macroValue: { color: Colors.text, fontSize: 18, fontWeight: "600", marginTop: 3, marginBottom: 10, fontVariant: ["tabular-nums"] },
macroGoal: { color: Colors.textSecondary, fontSize: 11, fontWeight: "400" },
macroTrack: { height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: "hidden" },
macroFill: { height: "100%", borderRadius: 2 },
```

(Adapt the data mapping to whatever variables the component already uses — do not invent new state.)

- [ ] **Step 3: Timeline flatten (both branches)**

Delete glow from `timelineDot`, shadows/radius-24 from `logCard`, the `itemCountBadge` pill, uppercase `timelineTime`. Rows become hairline-divided list items:

```ts
timelineTitle: { color: Colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.2 },
itemCountText: { color: Colors.textSecondary, fontSize: 13 },
timelineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
logRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
logName: { color: Colors.text, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.1, marginBottom: 3 },
logMeta: { color: Colors.textSecondary, fontSize: 12, fontVariant: ["tabular-nums"] },
logKcal: { color: Colors.text, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] },
```

Macro letters in the meta line keep per-macro colors (`Colors.protein` etc.). Kcal moves to a right-aligned figure. Keep edit/delete interactions exactly as they are (wrap rows in the same touchables).

- [ ] **Step 3b: Desktop branch arrangement**

The `isDesktop` branch keeps its existing grid container but arranges: hero card + macro card stacked in a left column (~320px), timeline panel filling the right (timeline panel gets `Colors.surface` bg + border + `Radii.card` since it floats next to the column). If the desktop branch already uses a similar split, keep its structure and only restyle.

- [ ] **Step 4: Sweep the rest of the file**

Apply Global Constraints to all remaining styles in the file (FAB, modals, empty states, edit-goal sheet): weights, radii via `Radii`, no glows, no uppercase micro-labels, FAB keeps `Colors.accent` background (this is one of the allowed accent uses), `elevation: 2` max.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → exit 0.
Run: `grep -n "fontWeight: \"800\"\|fontWeight: \"900\"\|shadowColor: Colors.accent\|textTransform" src/screens/DashboardScreen.tsx` → no output.

- [ ] **Step 6: Commit**

```bash
git add src/screens/DashboardScreen.tsx
git commit -m "feat: redesign dashboard hero, macros, and timeline for quiet dark"
```

---

### Task 3: Desktop sidebar — `src/components/DesktopSidebar.tsx`

**Files:**
- Modify: `src/components/DesktopSidebar.tsx` (styles + small JSX deltas; keep nav data, routing, streak fetch untouched)

- [ ] **Step 1: Restyle**

JSX deltas: streak panel `<View style={styles.streakPanel}>` with `Fire` icon → plain text line; remove the `iconContainer`/`iconActive` bubble (render `<Icon>` directly, `size={18}`); logout keeps icon+label but loses tinted box.

```tsx
{streak > 0 && (
  <Text style={styles.streakLine}>
    <Text style={styles.streakCount}>{streak}-day</Text> streak
  </Text>
)}
```

New styles (replacing same-named ones; delete `streakPanel`, `streakText` old versions, `iconContainer`, `iconActive`):

```ts
sidebar: { width: 240, backgroundColor: Colors.primary, borderRightWidth: 1, borderRightColor: Colors.borderLight, paddingTop: 32, paddingBottom: 18, paddingHorizontal: 16, height: "100%", minHeight: 0 },
brandName: { color: Colors.text, fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
logoBadge: { width: 34, height: 34, borderRadius: Radii.inner, backgroundColor: Colors.accentDim, alignItems: "center", justifyContent: "center" },
streakLine: { color: Colors.textSecondary, fontSize: 13, paddingHorizontal: 12, marginBottom: 16 },
streakCount: { color: Colors.accent, fontWeight: "600" },
navItem: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: 12, borderRadius: Radii.inner, gap: 11 },
navItemHover: { backgroundColor: Colors.surfaceHover },
navItemActive: { backgroundColor: Colors.accentDim },
navLabel: { color: Colors.textSecondary, fontSize: 14, fontWeight: "500" },
navLabelActive: { color: Colors.accent, fontWeight: "600" },
avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.border, alignItems: "center", justifyContent: "center" },
avatarLetter: { color: Colors.accent, fontWeight: "600", fontSize: 15 },
profileEmail: { color: Colors.textSecondary, fontSize: 13, fontWeight: "500" },
logoutBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: 12, borderRadius: Radii.inner, gap: 10, minHeight: 40 },
logoutBtnHover: { backgroundColor: Colors.surfaceHover },
logoutText: { color: Colors.textSecondary, fontSize: 13.5, fontWeight: "500" },
```

`SignOut` icon color → `Colors.textSecondary` (error red only if you keep it on hover — acceptable either way, prefer `Colors.textSecondary`). Active nav icon color stays `Colors.accent`, inactive `Colors.textSecondary`. Remove the `navItemActive` border and `#FF6B35` entirely.

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → exit 0.
Run: `grep -n "FF6B35\|fontWeight: \"800\"\|fontWeight: \"900\"" src/components/DesktopSidebar.tsx` → no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/DesktopSidebar.tsx
git commit -m "feat: quiet dark desktop sidebar"
```

---

### Task 4: Sweep — tab screens

**Files:**
- Modify: `app/(tabs)/add.tsx`, `app/(tabs)/stats.tsx`, `app/(tabs)/cookbook.tsx`, `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Apply Global Constraints to each file** — style-object edits only, no layout changes. Specifics: tab bar in `_layout.tsx` gets flat `Colors.primary` background, hairline top border, active tint `Colors.accent`, inactive `Colors.textSecondary`, no glow. `stats.tsx` charts pick up new macro colors automatically via tokens; also fix any raw hex bars/legend chips to `Colors.protein/carbs/fat` and calm axis label weights.

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → exit 0.
Run: `grep -n "fontWeight: \"800\"\|fontWeight: \"900\"\|ffcc00\|ff4d4d\|ffaa00\|00d0ff\|FF6B35" app/\(tabs\)/*.tsx` → no output.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)"
git commit -m "feat: quiet dark sweep for tab screens"
```

---

### Task 5: Sweep — stack screens and auth

**Files:**
- Modify: `app/my-foods.tsx`, `app/create-food.tsx`, `app/create-recipe.tsx`, `app/scan.tsx`, `app/auth.tsx`, `src/screens/AuthScreen.tsx`, `src/screens/ProfileScreen.tsx`, `src/styles/auth.ts`

- [ ] **Step 1: Apply Global Constraints to each file.** `src/styles/auth.ts` is a shared style sheet — same rules (weights, radii, flat cards). Primary CTA buttons keep `Colors.accent` background + `Colors.textOnAccent` text (allowed accent use); secondary buttons become `Colors.surface` + border.

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → exit 0.
Run: `grep -n "fontWeight: \"800\"\|fontWeight: \"900\"\|ffcc00\|ff4d4d\|ffaa00\|00d0ff\|FF6B35" app/my-foods.tsx app/create-food.tsx app/create-recipe.tsx app/scan.tsx app/auth.tsx src/screens/AuthScreen.tsx src/screens/ProfileScreen.tsx src/styles/auth.ts` → no output.

- [ ] **Step 3: Commit**

```bash
git add app/my-foods.tsx app/create-food.tsx app/create-recipe.tsx app/scan.tsx app/auth.tsx src/screens/AuthScreen.tsx src/screens/ProfileScreen.tsx src/styles/auth.ts
git commit -m "feat: quiet dark sweep for stack screens and auth"
```

---

### Task 6: Sweep — shared components

**Files:**
- Modify: `src/components/ai/AiEstimateBadge.tsx`, `src/components/ai/AiFoodSheet.tsx`, `src/components/ai/BeeGuide.tsx`, `src/components/ai/BeeQuickLog.tsx`, `src/components/feedback/SweetFeedback.tsx`, `src/components/nutrition/TargetBreakdown.tsx`, `src/components/nutrition/UnitSystemToggle.tsx`, `src/components/scan/NotFoundSheet.tsx`

- [ ] **Step 1: Apply Global Constraints to each file.** The Bee surfaces may keep `Colors.accent`/`Colors.accentDim` tints (the Bee is an allowed accent use) but lose glows, 800/900 weights, and uppercase labels. Sheets/modals: `Radii.card`, flat borders, `elevation` ≤ 2.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test` → exit 0 (component tests exist for AI surfaces).
Run: `grep -rn "fontWeight: \"800\"\|fontWeight: \"900\"\|ffcc00\|ff4d4d\|ffaa00\|00d0ff\|FF6B35" src/components` → no output.

- [ ] **Step 3: Commit**

```bash
git add src/components
git commit -m "feat: quiet dark sweep for shared components"
```

---

### Task 7: Global gates

- [ ] **Step 1: Repo-wide greps** (all must return nothing):

```bash
grep -rn "fontWeight: \"800\"\|fontWeight: \"900\"" app src --include="*.tsx" --include="*.ts"
grep -rni "ffcc00\|ff4d4d\|ffaa00\|00d0ff\|FF6B35" app src --include="*.tsx" --include="*.ts"
grep -rn "shadowColor: Colors.accent" app src
grep -rn "textTransform: \"uppercase\"" app src --include="*.tsx"
```

(Last grep: any survivor must be an intentional, justified case — expect zero.)

- [ ] **Step 2: Full checks**

Run: `npm run typecheck && npm test && npm run lint`
Expected: typecheck exit 0; all vitest suites pass; lint no NEW warnings vs. main (pre-existing warnings acceptable).

- [ ] **Step 3: Commit any stragglers** with `fix: quiet dark gate cleanup`.

---

### Task 8: Browser verification

- [ ] **Step 1: Start Expo web** — `npx expo start --web --port 9100` (background).

- [ ] **Step 2: Playwright pass** — for each of: auth screen, dashboard, add/find food, cookbook, my-foods, stats, profile, scan, create-food:
  - screenshot at 375 / 768 / 1440 px widths,
  - capture console errors and failed network requests (expect none new),
  - drive: FAB menu open/close, edit-goal modal, Bee quick log open, AI food sheet.

- [ ] **Step 3: Fix anything that looks broken** (overflow, unreadable contrast, leftover glow) and re-screenshot. Commit fixes as `fix: quiet dark polish from browser verification`.

- [ ] **Step 4: Report** — summarize screenshots, console status, and gate results.
