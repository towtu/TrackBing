# Bee Companion Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the muscular Bee with an original eight-pose interactive companion and make the dashboard calorie target read-only while retaining TrackBing's profile-based nutrition calculation.

**Architecture:** A pure `beeCompanion` module owns semantic situations, pose mapping, accessibility copy, mood conversion, and deterministic tap reactions. `BeeMascot` owns assets and accessible motion; `BeeGuide` owns dashboard/compact/chat composition. Existing screens provide situations only, and the dashboard's alternate custom-calorie write path is deleted without changing nutrition formulas or stored legacy targets.

**Tech Stack:** Expo 54, React Native 0.81, TypeScript strict mode, React Native `Animated`/`AccessibilityInfo`, Vitest, built-in image generation plus local chroma-key removal, ffmpeg, Playwright CLI.

---

## Scope and existing-work guard

The tree already contains user-owned changes:

```text
 M app/(tabs)/add.tsx
 M app/(tabs)/cookbook.tsx
 M app/(tabs)/stats.tsx
?? codex.diff
```

Do not discard, reset, reformat, or include those changes in a broad commit.
`add.tsx` already consumes `BeeGuide`, so the shared redesign updates its art
without requiring most of that file to change. If the explicit loading
situation is added there, stage only that hunk interactively and confirm the
cached diff before committing. `cookbook.tsx`, `stats.tsx`, and `codex.diff`
remain untouched.

## File responsibility map

- Create `src/lib/beeCompanion.ts` — pure situation/pose contracts, mood
  conversion, labels, and deterministic tap reactions.
- Create `src/lib/beeCompanion.test.ts` — exhaustive mapping, fallback, mood,
  and reaction tests.
- Create `assets/images/bee/bee-*.png` — eight optimized transparent Bee poses.
- Modify `src/components/ai/BeeGuide.tsx` — semantic pose assets, accessible
  animation, integrated dashboard/compact/chat variants, tap reactions.
- Modify `src/screens/DashboardScreen.tsx` — situation mapping, interactive Bee,
  and read-only calculated calorie target.
- Modify `src/components/ai/BeeQuickLog.tsx` — per-message situations and small
  Bee portraits.
- Modify `src/components/ai/AiFoodSheet.tsx` — review/searching situations.
- Modify `app/create-food.tsx` — encouraging/searching/review state.
- Optionally modify one isolated hunk in `app/(tabs)/add.tsx` — explicit
  searching state while its existing user changes remain unstaged.
- Modify `src/components/scan/NotFoundSheet.tsx` — compact barcode-not-found Bee.
- Delete only the nine obsolete `assets/images/bee-power-*.png` files after a
  zero-reference scan.

### Task 0: Record the baseline and protect user-owned changes

**Files:**
- Read only: `app/(tabs)/add.tsx`
- Read only: `app/(tabs)/cookbook.tsx`
- Read only: `app/(tabs)/stats.tsx`
- Read only: `codex.diff`

- [ ] **Step 1: Record the exact dirty-tree baseline**

Run:

```bash
git status --short
git diff --stat
git diff -- app/'(tabs)'/add.tsx app/'(tabs)'/cookbook.tsx app/'(tabs)'/stats.tsx
```

Expected: the three modified tab files and untracked `codex.diff` shown above;
no staged files.

- [ ] **Step 2: Run the existing focused tests before changing behavior**

Run:

```bash
npm test -- src/lib/beeCoach.test.ts src/lib/nutritionTargets.test.ts
```

Expected: both test files pass. If they fail, stop and diagnose the existing
failure before attributing it to this feature.

- [ ] **Step 3: Confirm the old Bee and calorie-editor entry points**

Run:

```bash
rg -n 'bee-power-|mood=' src app assets
rg -n 'newGoalInput|handleSaveGoal|openCustomGoalEditor|Custom daily calorie target' src/screens/DashboardScreen.tsx
```

Expected: old Bee imports in `BeeGuide.tsx`, mood props in Dashboard/Quick Log,
and the dashboard custom-calorie editor symbols.

### Task 1: Add the pure situation model with TDD

**Files:**
- Create: `src/lib/beeCompanion.test.ts`
- Create: `src/lib/beeCompanion.ts`
- Read: `src/lib/beeCoach.ts`

- [ ] **Step 1: Write exhaustive failing tests**

Create `src/lib/beeCompanion.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BEE_SITUATIONS,
  beeMoodToSituation,
  getBeeAccessibilityLabel,
  getBeePose,
  getBeeTapReaction,
} from "./beeCompanion";

describe("beeCompanion", () => {
  it("maps every supported situation to the approved pose", () => {
    expect(
      Object.fromEntries(
        BEE_SITUATIONS.map((situation) => [
          situation,
          getBeePose(situation),
        ]),
      ),
    ).toEqual({
      greeting: "greeting",
      emptyDay: "encouraging",
      firstMeal: "success",
      searching: "searching",
      needsClarification: "thinking",
      reviewingMatch: "thinking",
      logSuccess: "success",
      streak: "celebrating",
      lowProtein: "encouraging",
      underTarget: "encouraging",
      nearTarget: "success",
      overTarget: "caution",
      inactiveReturn: "resting",
      lookupError: "caution",
      barcodeFound: "success",
      barcodeNotFound: "thinking",
      emptyCollection: "encouraging",
    });
  });

  it("falls back to greeting for a missing situation", () => {
    expect(getBeePose(undefined)).toBe("greeting");
    expect(getBeePose(null)).toBe("greeting");
  });

  it("converts existing coaching moods without changing coaching rules", () => {
    expect(beeMoodToSituation("inactiveMonth")).toBe("inactiveReturn");
    expect(beeMoodToSituation("inactiveWeek")).toBe("inactiveReturn");
    expect(beeMoodToSituation("empty")).toBe("emptyDay");
    expect(beeMoodToSituation("over")).toBe("overTarget");
    expect(beeMoodToSituation("strongProtein")).toBe("nearTarget");
    expect(beeMoodToSituation("lowProtein")).toBe("lowProtein");
    expect(beeMoodToSituation("streak")).toBe("streak");
    expect(beeMoodToSituation("under")).toBe("underTarget");
    expect(beeMoodToSituation("steady")).toBe("nearTarget");
  });

  it("returns deterministic, supportive tap reactions", () => {
    expect(getBeeTapReaction("emptyDay", 0)).toBe(
      "One quick log is enough to get today moving.",
    );
    expect(getBeeTapReaction("emptyDay", 3)).toBe(
      "One quick log is enough to get today moving.",
    );
    expect(getBeeTapReaction("overTarget", 1)).not.toMatch(
      /bad|failed|cheat|guilt/i,
    );
  });

  it("provides a contextual accessibility label", () => {
    expect(getBeeAccessibilityLabel("searching")).toBe(
      "Bee is searching for a food match",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- src/lib/beeCompanion.test.ts
```

Expected: FAIL because `./beeCompanion` does not exist.

- [ ] **Step 3: Implement the minimal pure module**

Create `src/lib/beeCompanion.ts`:

```ts
import type { BeeMood } from "./beeCoach";

export const BEE_POSES = [
  "greeting",
  "thinking",
  "encouraging",
  "celebrating",
  "caution",
  "resting",
  "searching",
  "success",
] as const;

export type BeePose = (typeof BEE_POSES)[number];

export const BEE_SITUATIONS = [
  "greeting",
  "emptyDay",
  "firstMeal",
  "searching",
  "needsClarification",
  "reviewingMatch",
  "logSuccess",
  "streak",
  "lowProtein",
  "underTarget",
  "nearTarget",
  "overTarget",
  "inactiveReturn",
  "lookupError",
  "barcodeFound",
  "barcodeNotFound",
  "emptyCollection",
] as const;

export type BeeSituation = (typeof BEE_SITUATIONS)[number];

const POSE_BY_SITUATION: Record<BeeSituation, BeePose> = {
  greeting: "greeting",
  emptyDay: "encouraging",
  firstMeal: "success",
  searching: "searching",
  needsClarification: "thinking",
  reviewingMatch: "thinking",
  logSuccess: "success",
  streak: "celebrating",
  lowProtein: "encouraging",
  underTarget: "encouraging",
  nearTarget: "success",
  overTarget: "caution",
  inactiveReturn: "resting",
  lookupError: "caution",
  barcodeFound: "success",
  barcodeNotFound: "thinking",
  emptyCollection: "encouraging",
};

const ACCESSIBILITY_LABELS: Record<BeeSituation, string> = {
  greeting: "Bee is ready to help",
  emptyDay: "Bee encourages your first food log",
  firstMeal: "Bee celebrates your first meal log",
  searching: "Bee is searching for a food match",
  needsClarification: "Bee needs one more food detail",
  reviewingMatch: "Bee is reviewing a food match",
  logSuccess: "Bee celebrates a successful food log",
  streak: "Bee celebrates your logging streak",
  lowProtein: "Bee suggests a protein boost",
  underTarget: "Bee shows that there is room to fuel",
  nearTarget: "Bee celebrates balanced pacing",
  overTarget: "Bee offers a gentle target reminder",
  inactiveReturn: "Bee welcomes you back",
  lookupError: "Bee could not complete the food lookup",
  barcodeFound: "Bee found the scanned product",
  barcodeNotFound: "Bee needs help identifying the scanned product",
  emptyCollection: "Bee encourages adding the first item",
};

const TAP_REACTIONS: Record<BeeSituation, readonly [string, string, string]> = {
  greeting: ["Ready when you are.", "What are we logging?", "Let’s make today count."],
  emptyDay: [
    "One quick log is enough to get today moving.",
    "Start small—your next meal is a good place.",
    "I’ll keep the first log easy.",
  ],
  firstMeal: ["First log landed.", "That’s the day started.", "Nice first step."],
  searching: ["Checking the closest match.", "Still looking.", "Almost there."],
  needsClarification: ["One detail will sharpen the estimate.", "A little context helps.", "Tell me the portion or preparation."],
  reviewingMatch: ["Check the serving before logging.", "You stay in control of the final numbers.", "Review first, then log."],
  logSuccess: ["Logged and ready.", "That meal is in.", "Nice—your totals are updated."],
  streak: ["Consistency looks good on you.", "Keep the rhythm.", "Small logs, strong streak."],
  lowProtein: ["A small protein add-on can help.", "Eggs, tofu, yogurt, or chicken could fit.", "Your next meal can balance this."],
  underTarget: ["There is still room to fuel.", "Keep listening to your appetite.", "You have space for another meal."],
  nearTarget: ["Smooth pacing today.", "You’re close to the target zone.", "Steady work."],
  overTarget: ["No guilt—just useful information.", "One day does not define progress.", "Log it, learn, and continue."],
  inactiveReturn: ["Welcome back.", "A fresh log is a fresh start.", "No catching up required."],
  lookupError: ["Try again or search manually.", "The lookup paused, not your progress.", "Your other logging tools still work."],
  barcodeFound: ["Product found.", "Check the serving, then log.", "The barcode match is ready."],
  barcodeNotFound: ["Try another scan or create it manually.", "A clearer barcode may help.", "We can still add this food."],
  emptyCollection: ["Your first saved item starts here.", "Add one favorite to make this useful.", "A small collection is still a collection."],
};

const MOOD_TO_SITUATION: Record<BeeMood, BeeSituation> = {
  inactiveMonth: "inactiveReturn",
  inactiveWeek: "inactiveReturn",
  empty: "emptyDay",
  over: "overTarget",
  strongProtein: "nearTarget",
  lowProtein: "lowProtein",
  streak: "streak",
  under: "underTarget",
  steady: "nearTarget",
};

export function getBeePose(
  situation: BeeSituation | null | undefined,
): BeePose {
  return situation ? POSE_BY_SITUATION[situation] ?? "greeting" : "greeting";
}

export function getBeeAccessibilityLabel(situation: BeeSituation): string {
  return ACCESSIBILITY_LABELS[situation];
}

export function getBeeTapReaction(
  situation: BeeSituation,
  tapCount: number,
): string {
  const reactions = TAP_REACTIONS[situation];
  const index = Math.abs(Math.floor(tapCount)) % reactions.length;
  return reactions[index];
}

export function beeMoodToSituation(mood: BeeMood): BeeSituation {
  return MOOD_TO_SITUATION[mood];
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/lib/beeCompanion.test.ts src/lib/beeCoach.test.ts
```

Expected: both files pass; the existing coach still selects the same moods.

- [ ] **Step 5: Commit the pure model**

Run:

```bash
git add src/lib/beeCompanion.ts src/lib/beeCompanion.test.ts
git diff --cached --check
git commit -m "feat: add semantic Bee companion states"
```

Expected: a commit containing only the new pure module and tests.

### Task 2: Generate and validate the eight-pose Bee asset family

**Files:**
- Create: `assets/images/bee/bee-greeting.png`
- Create: `assets/images/bee/bee-thinking.png`
- Create: `assets/images/bee/bee-encouraging.png`
- Create: `assets/images/bee/bee-celebrating.png`
- Create: `assets/images/bee/bee-caution.png`
- Create: `assets/images/bee/bee-resting.png`
- Create: `assets/images/bee/bee-searching.png`
- Create: `assets/images/bee/bee-success.png`
- Temporary: `tmp/imagegen/bee-*-source.png`
- Temporary: `tmp/imagegen/bee-*-alpha.png`

- [ ] **Step 1: Prepare exact project and temporary directories**

Run:

```bash
mkdir -p assets/images/bee tmp/imagegen
```

Expected: both directories exist; no existing asset is overwritten.

- [ ] **Step 2: Generate the greeting reference with built-in image generation**

Use the built-in image generator with this prompt:

```text
Use case: stylized-concept
Asset type: mobile nutrition app mascot pose
Primary request: Create an original compact bee companion named Bee, waving hello.
Subject: A small round honey bee with a large expressive head, warm brown eyes, small striped body, short limbs, soft antennae, translucent leaf-shaped wings, and a small charcoal crossbody food-log pouch with a subtle honeycomb mark.
Style/medium: polished premium storybook-style 3D character illustration; friendly and modern, not childish.
Composition/framing: full body centered, generous padding, strong silhouette, readable at 64px.
Color palette: honey gold, charcoal, cream wings, restrained muted moss accents.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background for background removal.
Constraints: identical anatomy and outfit must be reusable for seven later poses; background is one uniform color with no floor, shadow, gradient, texture, reflection, or lighting variation; crisp separated edges; no #ff00ff in the subject.
Avoid: muscular or human-sized anatomy, gym clothing, oversized sneakers, resemblance to a tarsier or bird mascot, text, watermark, cast shadow, contact shadow.
```

Save the selected source as `tmp/imagegen/bee-greeting-source.png`.

- [ ] **Step 3: Generate seven identity-preserving pose variants**

Use `bee-greeting-source.png` as the reference/edit target for seven separate
built-in image-generation calls. Repeat all identity invariants and change only
the pose/prop:

```text
Keep the exact same Bee identity, face, body proportions, markings, eye color,
wings, pouch, materials, rendering style, lighting, scale, framing, and flat
#ff00ff background. Change only the pose and named prop. No text, watermark,
shadow, floor, gradient, or extra character.
```

Generate:

```text
thinking: looking down at the small food-log notebook with one thoughtful hand near the chin
encouraging: open supportive stance, gently pointing toward an action beside the character
celebrating: hovering slightly with both arms raised and a joyful but controlled expression
caution: gentle concerned expression with open palms, supportive rather than scolding
resting: relaxed sleepy pose seated beside the pouch, warm welcome-back expression
searching: holding a simple magnifying glass over a generic food label with no text
success: holding a checked food-log card represented only by a simple check symbol
```

Save each selected source to `tmp/imagegen/bee-<pose>-source.png`.

- [ ] **Step 4: Remove the chroma key**

For each pose, run the installed helper:

```bash
python /home/kobinggg/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py \
  --input tmp/imagegen/bee-greeting-source.png \
  --out tmp/imagegen/bee-greeting-alpha.png \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill
```

Repeat with each pose filename. If one image has a visible fringe, rerun only
that pose with `--edge-contract 1`.

- [ ] **Step 5: Downscale to a retina-safe app size**

For each pose:

```bash
ffmpeg -y \
  -i tmp/imagegen/bee-greeting-alpha.png \
  -vf "scale=-2:640:flags=lanczos" \
  -pix_fmt rgba \
  assets/images/bee/bee-greeting.png
```

Repeat with each pose filename. Height 640 keeps at least 4× density for the
largest 144-pixel render without bundling the original generation size.

- [ ] **Step 6: Validate identity, transparency, and weight**

Run:

```bash
file assets/images/bee/*.png
du -h assets/images/bee/*.png
```

Expected: eight RGBA PNGs. Inspect every image with `view_image` against the
greeting reference. Reject and regenerate any variant with identity drift,
magenta fringe, cropped wings/antennae, unreadable prop, or an unrelated
character. Confirm transparent corners and thumbnail legibility.

- [ ] **Step 7: Delete the exact temporary generation files**

After all eight final PNGs pass visual inspection, run:

```bash
rm \
  tmp/imagegen/bee-greeting-source.png \
  tmp/imagegen/bee-thinking-source.png \
  tmp/imagegen/bee-encouraging-source.png \
  tmp/imagegen/bee-celebrating-source.png \
  tmp/imagegen/bee-caution-source.png \
  tmp/imagegen/bee-resting-source.png \
  tmp/imagegen/bee-searching-source.png \
  tmp/imagegen/bee-success-source.png \
  tmp/imagegen/bee-greeting-alpha.png \
  tmp/imagegen/bee-thinking-alpha.png \
  tmp/imagegen/bee-encouraging-alpha.png \
  tmp/imagegen/bee-celebrating-alpha.png \
  tmp/imagegen/bee-caution-alpha.png \
  tmp/imagegen/bee-resting-alpha.png \
  tmp/imagegen/bee-searching-alpha.png \
  tmp/imagegen/bee-success-alpha.png
rmdir tmp/imagegen
```

Expected: only the eight optimized files under `assets/images/bee/` remain.
Do not delete or replace any other image asset.

- [ ] **Step 8: Commit only the final assets**

Run:

```bash
git add assets/images/bee
git diff --cached --stat
git commit -m "feat: add original Bee companion pose set"
```

Expected: eight final PNGs committed and no generated source or alpha
intermediates remain in the repository tree.

### Task 3: Rebuild `BeeMascot` and `BeeGuide`

**Files:**
- Modify: `src/components/ai/BeeGuide.tsx`
- Test: `src/lib/beeCompanion.test.ts`

- [ ] **Step 1: Add a failing label coverage assertion**

Extend `src/lib/beeCompanion.test.ts`:

```ts
it("provides non-empty labels for every situation", () => {
  for (const situation of BEE_SITUATIONS) {
    expect(getBeeAccessibilityLabel(situation).trim().length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
npm test -- src/lib/beeCompanion.test.ts
```

Expected: PASS if Task 1 is complete; this locks the accessibility contract
before the component consumes it.

- [ ] **Step 3: Replace mood assets with semantic pose assets**

In `src/components/ai/BeeGuide.tsx`, replace `BeeMood` imports/props and the old
asset map with:

```ts
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  beeMoodToSituation,
  getBeeAccessibilityLabel,
  getBeePose,
  getBeeTapReaction,
  type BeePose,
  type BeeSituation,
} from "@/src/lib/beeCompanion";
import type { BeeMood } from "@/src/lib/beeCoach";

type BeeGuideVariant = "dashboard" | "compact" | "chat";

type BeeGuideProps = {
  title: string;
  message: string;
  action?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  mascotSize?: BeeMascotSize;
  situation?: BeeSituation;
  mood?: BeeMood;
  interactive?: boolean;
  variant?: BeeGuideVariant;
  style?: StyleProp<ViewStyle>;
};

const BEE_POSE_MASCOTS: Record<BeePose, ImageSourcePropType> = {
  greeting: require("../../../assets/images/bee/bee-greeting.png"),
  thinking: require("../../../assets/images/bee/bee-thinking.png"),
  encouraging: require("../../../assets/images/bee/bee-encouraging.png"),
  celebrating: require("../../../assets/images/bee/bee-celebrating.png"),
  caution: require("../../../assets/images/bee/bee-caution.png"),
  resting: require("../../../assets/images/bee/bee-resting.png"),
  searching: require("../../../assets/images/bee/bee-searching.png"),
  success: require("../../../assets/images/bee/bee-success.png"),
};
```

- [ ] **Step 4: Implement local tap-message behavior in `BeeGuide`**

Keep a temporary `mood` compatibility prop while Dashboard and Quick Log are
migrated so every intermediate commit typechecks. Use the existing
title/message/footer/action markup, but change the function body to:

```tsx
export function BeeGuide({
  title,
  message,
  action,
  footer,
  compact = false,
  mascotSize = compact ? "small" : "medium",
  situation,
  mood,
  interactive = false,
  variant = compact ? "compact" : "dashboard",
  style,
}: BeeGuideProps) {
  const [tapCount, setTapCount] = useState(0);
  const lastTapAt = useRef(0);
  const activeSituation =
    situation ?? (mood ? beeMoodToSituation(mood) : "encouraging");

  useEffect(() => {
    setTapCount(0);
  }, [activeSituation, message]);

  const displayedMessage =
    interactive && tapCount > 0
      ? getBeeTapReaction(activeSituation, tapCount - 1)
      : message;

  const handleMascotPress = () => {
    const now = Date.now();
    if (now - lastTapAt.current < 450) return;
    lastTapAt.current = now;
    setTapCount((current) => Math.min(current + 1, 4));
  };

  return (
    <View
      style={[
        styles.card,
        variant === "dashboard"
          ? styles.cardDashboard
          : variant === "chat"
            ? styles.cardChat
            : styles.cardCompactVariant,
        compact && styles.cardCompact,
        style,
      ]}
    >
      <BeeMascot
        situation={activeSituation}
        size={mascotSize}
        onPress={interactive ? handleMascotPress : undefined}
      />
      <View style={styles.content}>
        <View style={[styles.bubble, compact && styles.bubbleCompact]}>
          <View style={styles.bubbleTail} />
          <Text style={styles.speaker}>Bee</Text>
          <Text style={[styles.title, compact && styles.titleCompact]}>
            {title}
          </Text>
          <Text style={[styles.message, compact && styles.messageCompact]}>
            {displayedMessage}
          </Text>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}
```

Add variant styles without changing the quiet-dark palette:

```ts
cardDashboard: {
  position: "relative",
  paddingVertical: 8,
},
cardCompactVariant: {
  alignItems: "center",
},
cardChat: {
  gap: 8,
},
```

Keep card radii at 14–16 pixels, remove the old yellow glow-like border, and use
`Colors.border` with a restrained `Colors.accentDim` background tint.

- [ ] **Step 5: Implement accessible motion in `BeeMascot`**

Replace the existing `BeeMascot` with:

```tsx
export function BeeMascot({
  size = "medium",
  situation,
  mood,
  onPress,
  style,
}: {
  size?: BeeMascotSize;
  situation?: BeeSituation;
  mood?: BeeMood;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const frame = MASCOT_FRAME[size];
  const activeSituation =
    situation ?? (mood ? beeMoodToSituation(mood) : "greeting");
  const pose = getBeePose(activeSituation);
  const source = BEE_POSE_MASCOTS[pose];
  const scale = useRef(new Animated.Value(1)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0.72);
    const transition = Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    });
    transition.start();
    return () => transition.stop();
  }, [opacity, pose, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || activeSituation !== "searching") {
      translateY.stopAnimation();
      translateY.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -3,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 420,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [activeSituation, reduceMotion, translateY]);

  const handlePress = () => {
    if (!reduceMotion) {
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 0.94,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          tension: 190,
          friction: 7,
          useNativeDriver: true,
        }),
      ]).start();
    }
    onPress?.();
  };

  const image = (
    <Animated.View
      style={[
        styles.mascotWrap,
        { width: frame.width, height: frame.height },
        { opacity, transform: [{ scale }, { translateY }] },
        style,
      ]}
    >
      <Image
        accessible={false}
        source={source}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={[
          styles.mascotImage,
          { width: frame.width, height: frame.height },
        ]}
      />
    </Animated.View>
  );

  if (!onPress) return image;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={getBeeAccessibilityLabel(activeSituation)}
      accessibilityHint="Tap for another short coaching note"
      hitSlop={8}
      onPress={handlePress}
    >
      {image}
    </Pressable>
  );
}
```

- [ ] **Step 6: Run typecheck and focused tests**

Run:

```bash
npm run typecheck
npm test -- src/lib/beeCompanion.test.ts src/lib/beeCoach.test.ts
```

Expected: typecheck and both test files pass. The temporary `mood` bridge keeps
the existing Dashboard and Quick Log callers valid until Tasks 4 and 5 migrate
them.

- [ ] **Step 7: Commit after all callers compile**

Do not commit `BeeGuide.tsx` by itself. Stage it with Dashboard in Task 4, then
remove the temporary bridge with the last Quick Log migration in Task 5.

### Task 4: Integrate Dashboard Bee and remove direct calorie editing

**Files:**
- Modify: `src/screens/DashboardScreen.tsx`
- Test: `src/lib/beeCompanion.test.ts`

- [ ] **Step 1: Add the mood conversion assertion if it is not already present**

The Task 1 test named `converts existing coaching moods without changing
coaching rules` is the regression test. Run it before editing Dashboard:

```bash
npm test -- src/lib/beeCompanion.test.ts src/lib/beeCoach.test.ts
```

Expected: PASS.

- [ ] **Step 2: Remove the dashboard-only custom target state and write path**

In `src/screens/DashboardScreen.tsx`:

- Remove `PencilSimple`.
- Remove `CALORIE_FLOORS`, `DEFAULT_MACRO_PERCENTAGES`,
  `calculateMacroGrams`, and `validateMacroPercentages` imports.
- Remove `GoalProfile`.
- Remove `goalProfile`, `editGoalModal`, and `newGoalInput` state.
- Remove `handleSaveGoal` and `openCustomGoalEditor`.
- Remove the custom-calorie modal.
- Remove `age`, `gender`, and `goal_mode` from the Dashboard query, but keep
  reading the stored target, macro ratios, and macro grams:

```ts
.select(
  "calorie_target, protein_grams, carbs_grams, fat_grams, protein_ratio, carbs_ratio, fat_ratio",
)
```

- Remove the `GoalProfile` construction and default-ratio parsing that existed
  only for dashboard overrides. Do not write or normalize any stored ratios.

- [ ] **Step 3: Render the target as calculated and read-only**

Replace both desktop and mobile `goalButtonGroup` blocks with:

```tsx
<View style={styles.goalButtonGroup}>
  <View style={styles.calculatedGoal}>
    <Text style={styles.heroSmallLabel}>Daily target</Text>
    <View style={styles.goalValueRow}>
      <Text style={styles.goalValueText}>{calorieGoal}</Text>
      <Text style={styles.goalUnitText}>kcal</Text>
    </View>
  </View>
  <TouchableOpacity
    accessibilityRole="button"
    accessibilityLabel="View calorie calculation in Profile"
    hitSlop={4}
    onPress={() => router.push("/(tabs)/profile")}
  >
    <Text style={styles.goalHelper}>Calculated from your profile · View</Text>
  </TouchableOpacity>
</View>
```

Add:

```ts
calculatedGoal: {
  alignItems: "flex-start",
},
```

Delete styles used only by the custom target modal/input or edit trigger after
an `rg` usage check.

- [ ] **Step 4: Make the dashboard companion semantic and interactive**

Import:

```ts
import { beeMoodToSituation } from "@/src/lib/beeCompanion";
```

Change `renderBeeCompanion` to:

```tsx
const renderBeeCompanion = () => (
  <BeeGuide
    interactive
    variant="dashboard"
    compact={!isDesktop}
    mascotSize={isDesktop ? "large" : "medium"}
    situation={beeMoodToSituation(beeMessage.mood)}
    title={beeMessage.title}
    message={beeMessage.message}
    style={styles.beeCompanionCard}
  />
);
```

- [ ] **Step 5: Prove the direct calorie editor is gone**

Run:

```bash
rg -n 'newGoalInput|handleSaveGoal|openCustomGoalEditor|custom_calories|Custom daily calorie target|Replace your estimated daily target' src/screens/DashboardScreen.tsx
```

Expected: exit code 1 and no output.

Run:

```bash
rg -n 'calculateNutritionTarget|calculateMacroGrams|CALORIE_FLOORS|CUSTOM_RATE_LIMITS' src/lib/nutritionTargets.ts src/screens/ProfileScreen.tsx
```

Expected: the existing profile calculation, macro derivation, floors, and rate
limits remain present.

- [ ] **Step 6: Run typecheck and nutrition tests**

Run:

```bash
npm run typecheck
npm test -- src/lib/beeCompanion.test.ts src/lib/beeCoach.test.ts src/lib/nutritionTargets.test.ts
```

Expected: all pass.

- [ ] **Step 7: Commit Dashboard and shared component together**

Run:

```bash
git add src/components/ai/BeeGuide.tsx src/screens/DashboardScreen.tsx
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: add interactive Bee dashboard companion"
```

Expected: only the shared component and Dashboard are committed. The commit
also removes the dashboard custom-calorie write path.

### Task 5: Give Quick Log contextual Bee states

**Files:**
- Modify: `src/components/ai/BeeQuickLog.tsx`

- [ ] **Step 1: Extend the chat-message contract**

Import `BeeSituation` and add it to `ChatMessage`:

```ts
import type { BeeSituation } from "@/src/lib/beeCompanion";

type ChatMessage = {
  id: string;
  role: "bee" | "user";
  text: string;
  food?: AiFood;
  situation?: BeeSituation;
};
```

Set the starter situation:

```ts
{
  id: "starter",
  role: "bee",
  situation: "greeting",
  text: 'Tell Bee what you ate, like "600g chicken breast". If details matter, I\'ll ask before logging.',
}
```

- [ ] **Step 2: Assign situations at state transitions**

Add the following situation fields to the existing appended Bee messages:

```ts
// Clarification question
situation: "needsClarification",

// "Checking the best match..."
situation: "searching",

// Successful match awaiting review
situation: "reviewingMatch",

// AI request or database failure
situation: "lookupError",

// Successful food log
situation: "logSuccess",
```

Do not alter request, quota, confirmation, or owner-scoped database logic.

- [ ] **Step 3: Make launcher/header poses derive from live state**

Before the return:

```ts
const activeSituation: BeeSituation = loading
  ? "searching"
  : pendingClarification
    ? "needsClarification"
    : pendingFood
      ? "reviewingMatch"
      : "greeting";
```

Replace old mood props:

```tsx
<BeeMascot size="small" situation="encouraging" style={styles.launcherMascot} />
<BeeMascot size="small" situation={activeSituation} />
```

- [ ] **Step 4: Add a compact Bee portrait to Bee messages**

Wrap each message in a row:

```tsx
<View
  key={message.id}
  style={[
    styles.messageRow,
    message.role === "user" && styles.userMessageRow,
  ]}
>
  {message.role === "bee" ? (
    <BeeMascot
      size="small"
      situation={message.situation ?? (message.food ? "reviewingMatch" : "greeting")}
      style={styles.messageMascot}
    />
  ) : null}
  <View
    style={[
      styles.messageBubble,
      message.role === "user" ? styles.userBubble : styles.beeBubble,
    ]}
  >
    <Text
      style={[
        styles.messageText,
        message.role === "user"
          ? styles.userMessageText
          : styles.beeMessageText,
      ]}
    >
      {message.text}
    </Text>
    {message.food ? (
      <View style={styles.badgeRow}>
        <AiEstimateBadge source={message.food.source} compact />
        <Text style={styles.confidenceText}>
          {message.food.confidence} confidence
        </Text>
        {message.food.source_detail ? (
          <Text style={styles.sourceDetailText} numberOfLines={1}>
            {message.food.source === "web" ? "from " : "matched: "}
            {message.food.source_detail}
          </Text>
        ) : null}
      </View>
    ) : null}
  </View>
</View>
```

Add:

```ts
messageRow: {
  width: "100%",
  flexDirection: "row",
  alignItems: "flex-end",
  gap: 8,
},
userMessageRow: {
  justifyContent: "flex-end",
},
messageMascot: {
  marginBottom: 2,
},
```

Adjust `beeBubble` max width so the portrait plus bubble never overflows at
375 px.

- [ ] **Step 5: Remove the temporary mood compatibility bridge**

After the launcher, header, and message callers all use `situation`, edit
`src/components/ai/BeeGuide.tsx`:

- Remove the `BeeMood` import.
- Remove `beeMoodToSituation` from its companion-module import.
- Remove `mood?: BeeMood` from both component prop types.
- Remove `mood` from both parameter lists.
- Set `BeeGuide`'s `situation` default to `"encouraging"`.
- Set `BeeMascot`'s `situation` default to `"greeting"`.
- Replace both `activeSituation` bridge expressions with the already-defaulted
  `situation` value.

Run:

```bash
rg -n 'mood=' src app
```

Expected: exit code 1 and no output.

- [ ] **Step 6: Run checks**

Run:

```bash
npm run typecheck
npm test -- src/lib/beeCompanion.test.ts src/lib/beeQuickLog.test.ts src/lib/aiFoodUi.test.ts
```

Expected: typecheck and all focused tests pass.

- [ ] **Step 7: Commit Quick Log and bridge removal**

Run:

```bash
git add src/components/ai/BeeGuide.tsx src/components/ai/BeeQuickLog.tsx
git diff --cached --check
git commit -m "feat: add contextual Bee quick-log poses"
```

### Task 6: Integrate compact Bee states in existing guidance surfaces

**Files:**
- Modify: `src/components/ai/AiFoodSheet.tsx`
- Modify: `app/create-food.tsx`
- Modify: `src/components/scan/NotFoundSheet.tsx`
- Optionally modify one isolated hunk: `app/(tabs)/add.tsx`

- [ ] **Step 1: Make `AiFoodSheet` reflect lookup state**

Change its existing `BeeGuide` call:

```tsx
<BeeGuide
  compact
  variant="compact"
  situation={findingMore ? "searching" : "reviewingMatch"}
  title={findingMore ? "Looking for another match" : "Review before saving"}
  message={
    findingMore
      ? "I’m checking the web for a closer match."
      : "I found a draft for this serving. Check the numbers, then choose where it goes."
  }
  style={styles.beeHeader}
  footer={
    <>
      <View style={styles.provenanceRow}>
        <AiEstimateBadge source={food.source} compact />
        <Text
          style={[
            styles.confidence,
            { color: CONFIDENCE_COLOR[food.confidence] },
          ]}
        >
          {food.confidence} confidence
        </Text>
      </View>
      {food.source_detail ? (
        <Text style={styles.sourceDetail}>
          {food.source === "web" ? "from " : "matched: "}
          {food.source_detail}
        </Text>
      ) : null}
    </>
  }
/>
```

- [ ] **Step 2: Make Create Food reflect AI-fill state**

Change the existing `BeeGuide` call in `app/create-food.tsx`:

```tsx
<BeeGuide
  compact
  variant="compact"
  situation={
    aiFillLoading ? "searching" : aiFillSource ? "reviewingMatch" : "encouraging"
  }
  title={
    aiFillLoading
      ? "Checking that food"
      : aiFillSource
        ? "Draft ready to review"
        : "Want Bee to fill it?"
  }
  message={
    aiFillLoading
      ? "I’m preparing editable per-serving macros."
      : "Add a name, then Bee can draft per-serving macros you can edit."
  }
  style={styles.aiFillCard}
  footer={aiFillSource ? <AiEstimateBadge source={aiFillSource} compact /> : null}
  action={
    <TouchableOpacity
      accessibilityRole="button"
      disabled={aiFillLoading}
      onPress={handleAiFill}
      style={[
        styles.aiFillBtn,
        aiFillLoading && styles.aiFillBtnDisabled,
      ]}
    >
      {aiFillLoading ? (
        <ActivityIndicator color={Colors.textOnAccent} />
      ) : (
        <Text style={styles.aiFillBtnText}>AI fill</Text>
      )}
    </TouchableOpacity>
  }
/>
```

- [ ] **Step 3: Replace the barcode-not-found icon with compact Bee guidance**

In `src/components/scan/NotFoundSheet.tsx`, import `BeeGuide`, remove the
standalone magnifying-glass icon block, and insert:

```tsx
<BeeGuide
  compact
  variant="compact"
  situation="barcodeNotFound"
  title="Product not found"
  message={message}
  style={styles.beeGuide}
/>
```

Keep both existing actions and modal dismissal behavior unchanged. Add:

```ts
beeGuide: {
  marginBottom: 24,
},
```

- [ ] **Step 4: Add the explicit Add Food situation only if it is an isolated hunk**

In the existing `BeeGuide` call in `app/(tabs)/add.tsx`, add:

```tsx
situation={aiLoading ? "searching" : "encouraging"}
variant="compact"
```

Do not reformat or stage any surrounding user-owned changes.

- [ ] **Step 5: Run checks**

Run:

```bash
npm run typecheck
npm test -- src/lib/beeCompanion.test.ts src/lib/aiFoodUi.test.ts
```

Expected: PASS.

- [ ] **Step 6: Stage clean files, then isolate the Add Food hunk**

Run:

```bash
git add src/components/ai/AiFoodSheet.tsx app/create-food.tsx src/components/scan/NotFoundSheet.tsx
git add -p app/'(tabs)'/add.tsx
git diff --cached --name-only
git diff --cached -- app/'(tabs)'/add.tsx
```

For `git add -p`, stage only the two new `BeeGuide` props. The cached Add Food
diff must not contain pre-existing radius, weight, shadow, or copy changes.

- [ ] **Step 7: Commit compact integrations**

Run:

```bash
git diff --cached --check
git commit -m "feat: extend Bee states across food guidance"
```

After commit, run `git status --short`; the original unrelated Add/Cookbook/
Stats changes and `codex.diff` must still be present.

### Task 7: Remove obsolete Bee assets only after proving zero references

**Files:**
- Delete: `assets/images/bee-power-empty.png`
- Delete: `assets/images/bee-power-inactive-month.png`
- Delete: `assets/images/bee-power-inactive-week.png`
- Delete: `assets/images/bee-power-low-protein.png`
- Delete: `assets/images/bee-power-over.png`
- Delete: `assets/images/bee-power-pose.png`
- Delete: `assets/images/bee-power-streak.png`
- Delete: `assets/images/bee-power-strong-protein.png`
- Delete: `assets/images/bee-power-under.png`

- [ ] **Step 1: Prove no code references remain**

Run:

```bash
rg -n 'bee-power-' src app assets docs --glob '!docs/superpowers/specs/2026-07-29-bee-companion-redesign.md' --glob '!docs/superpowers/plans/2026-07-29-bee-companion-redesign.md'
```

Expected: exit code 1 and no output. If any code reference remains, migrate it
before deletion.

- [ ] **Step 2: Confirm the exact tracked deletion set**

Run:

```bash
git ls-files 'assets/images/bee-power-*.png'
```

Expected: exactly the nine files listed in this task—no logo, application icon,
or splash asset.

- [ ] **Step 3: Delete the exact obsolete set recoverably through Git**

Run:

```bash
git rm \
  assets/images/bee-power-empty.png \
  assets/images/bee-power-inactive-month.png \
  assets/images/bee-power-inactive-week.png \
  assets/images/bee-power-low-protein.png \
  assets/images/bee-power-over.png \
  assets/images/bee-power-pose.png \
  assets/images/bee-power-streak.png \
  assets/images/bee-power-strong-protein.png \
  assets/images/bee-power-under.png
```

- [ ] **Step 4: Verify and commit deletion**

Run:

```bash
npm run typecheck
git diff --cached --stat
git commit -m "chore: remove obsolete Bee mascot assets"
```

Expected: typecheck passes and the commit contains only the nine deletions.

### Task 8: Full review, browser verification, and final quality gate

**Files:**
- Review all feature commits and modified files.
- Create screenshots under `output/playwright/` only.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm run typecheck
npm test
npm run lint
```

Expected: all commands exit 0. Record test counts and any non-failing warnings.

- [ ] **Step 2: Run source-level acceptance checks**

Run:

```bash
rg -n 'bee-power-|mood=' src app assets
rg -n 'newGoalInput|handleSaveGoal|openCustomGoalEditor|Custom daily calorie target' src/screens/DashboardScreen.tsx
rg -n 'Calculated from your profile' src/screens/DashboardScreen.tsx
git status --short
```

Expected:

- no old Bee or old mood prop references
- no dashboard custom-target editor symbols
- the calculated helper appears in both responsive Dashboard branches
- only the user's pre-existing tab changes, `codex.diff`, and ignored/local
  temporary artifacts remain

- [ ] **Step 3: Start the existing Expo web app**

Run:

```bash
npm run web -- --port 8082
```

Expected: Expo reports `Web is waiting on http://localhost:8082`. Use another
free port only if 8082 is already occupied and record the actual URL.

- [ ] **Step 4: Verify with Playwright at required widths**

Use the bundled wrapper:

```bash
/home/kobinggg/.codex/skills/playwright/scripts/playwright_cli.sh open http://localhost:8082 --headed
/home/kobinggg/.codex/skills/playwright/scripts/playwright_cli.sh snapshot
```

Verify Dashboard at 375×812, 768×1024, and 1440×1000. Save:

```text
output/playwright/bee-dashboard-375.png
output/playwright/bee-dashboard-768.png
output/playwright/bee-dashboard-1440.png
```

At each width confirm:

- Bee does not cover coaching text or controls.
- No horizontal scroll.
- The daily target is read-only and says `Calculated from your profile`.
- The Profile route opens from the helper.
- The bottom navigation/FAB remains unobstructed on mobile.

- [ ] **Step 5: Drive Bee interactions and Quick Log**

From a fresh snapshot:

1. Tap Dashboard Bee and confirm one short message change plus a bounce.
2. Tap repeatedly and confirm the message count is bounded.
3. Open Quick Log.
4. Confirm starter Bee portrait.
5. Submit a normal food query and capture searching state.
6. Confirm review pose after a match.
7. Confirm success pose after logging, or use the safe review path if the test
   account must not mutate production-like data.
8. Toggle reduced motion in the browser/emulation environment and confirm pose
   changes remain usable without bounce/hover.

Save before/search/review screenshots under `output/playwright/`.

- [ ] **Step 6: Inspect console and network**

Use Playwright console/network inspection. Expected:

- no uncaught errors
- no missing Bee asset requests
- no request caused only by tapping Bee
- existing AI or Supabase failures, if test credentials are absent, are shown
  through the existing graceful UI and documented rather than hidden

- [ ] **Step 7: Self-review the diff**

Review:

```bash
git log --oneline 076d919..HEAD
git diff 076d919..HEAD -- src app
git diff 076d919..HEAD --stat
```

Check:

- no `any` introduced
- no unrelated formatting
- animation cleanup on unmount
- reduced motion honored
- no nested interactive control
- accessibility labels are contextual
- all Supabase mutations remain owner-scoped
- no secrets or generated temporary files committed

- [ ] **Step 8: Run the security gate**

State explicitly:

```text
Security check: no backend/schema/RLS changes; Bee taps are presentation-only;
no new network request or write path; dashboard custom-calorie mutation removed;
existing Supabase owner scoping unchanged; generated assets contain no user data.
```

- [ ] **Step 9: Final verification**

Rerun after any review fix:

```bash
npm run typecheck
npm test
npm run lint
git status --short
```

Only report completion from these fresh results. Include the exact preserved
user-owned dirty files, screenshot paths, deleted files, and any warnings.
