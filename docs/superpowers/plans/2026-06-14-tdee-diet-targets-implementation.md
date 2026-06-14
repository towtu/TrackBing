# TrackBing TDEE and Diet Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TrackBing's duplicated calorie math with one tested adult/minor nutrition-target module, add metric and imperial entry, persist explicit goal intent, and make signup, profile, and dashboard targets consistent.

**Architecture:** `src/lib/nutritionTargets.ts` owns all body-energy calculations, safeguards, macro conversions, validation, and unit conversion. Screens keep canonical kilograms and centimeters, persist `goal_mode`, `goal_rate`, and `unit_system`, and use small shared presentation components for unit selection and target breakdowns. Existing rows without metadata remain unchanged and load as legacy custom targets until the user explicitly selects a new plan.

**Tech Stack:** Expo 54, React Native 0.81, React 19, TypeScript 5.9, Supabase, Vitest

---

## File Map

- Create `src/lib/nutritionTargets.ts`: adult Mifflin-St Jeor, adolescent NASEM EER, rate caps, calorie floors, validation, macro targets, and unit conversion.
- Create `src/lib/nutritionTargets.test.ts`: fixed calculation vectors, boundary tests, conversion tests, and validation tests.
- Create `src/components/nutrition/UnitSystemToggle.tsx`: shared Metric/Imperial segmented control.
- Create `src/components/nutrition/TargetBreakdown.tsx`: shared maintenance, rate, adjustment, and target explanation.
- Create `supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql`: nullable goal metadata and database constraints.
- Modify `package.json` and `package-lock.json`: Vitest dependency and test/typecheck scripts.
- Modify `src/lib/macros.ts`: remove body-energy code so it returns to food and recipe macro math only.
- Modify `src/screens/AuthScreen.tsx`: shared calculation path, minor flow, imperial signup, and complete initial macro persistence.
- Modify `src/styles/auth.ts`: signup unit-toggle, imperial-height, minor notice, and result styles.
- Modify `src/screens/ProfileScreen.tsx`: explicit goal metadata, legacy behavior, minor restrictions, target breakdown, validation, and persisted unit preference.
- Modify `src/screens/DashboardScreen.tsx`: adult-only custom calorie override, sex-specific floor, explicit custom goal mode, and shared macro conversion.
- Modify `README.md`: document the new migration and target behavior.

Do not modify or stage `supabase/recipes.sql`; it is unrelated existing work.

### Task 1: Add the calculation test harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/nutritionTargets.test.ts`

- [ ] **Step 1: Install Vitest and add explicit scripts**

Run:

```bash
npm install --save-dev vitest
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
npm pkg set scripts.typecheck="tsc --noEmit"
```

Expected: `package.json` contains the three scripts and `vitest` under
`devDependencies`; `package-lock.json` records the installed package.

- [ ] **Step 2: Write the first failing adult-target tests**

Create `src/lib/nutritionTargets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  calculateNutritionTarget,
  type NutritionTargetInput,
} from "./nutritionTargets";

const adultBase: NutritionTargetInput = {
  age: 30,
  sex: "male",
  weightKg: 80,
  heightCm: 180,
  activityLevel: "moderate",
  weeklyRate: -0.005,
};

describe("calculateNutritionTarget for adults", () => {
  it("uses Mifflin-St Jeor and the selected activity level", () => {
    expect(calculateNutritionTarget(adultBase)).toMatchObject({
      maintenanceCalories: 2759,
      requestedRate: -0.005,
      requestedAdjustment: -440,
      appliedAdjustment: -440,
      finalCalories: 2319,
      floorApplied: false,
      adjustmentCapApplied: false,
      calculationMethod: "mifflin_st_jeor",
    });
  });

  it("caps an aggressive deficit at 30 percent of maintenance", () => {
    expect(
      calculateNutritionTarget({
        age: 30,
        sex: "female",
        weightKg: 60,
        heightCm: 165,
        activityLevel: "sedentary",
        weeklyRate: -0.01,
      }),
    ).toMatchObject({
      maintenanceCalories: 1584,
      requestedAdjustment: -660,
      finalCalories: 1200,
      floorApplied: true,
      adjustmentCapApplied: true,
    });
  });

  it("treats 1000 kcal as a deficit ceiling, not a preset", () => {
    expect(
      calculateNutritionTarget({
        age: 30,
        sex: "male",
        weightKg: 150,
        heightCm: 190,
        activityLevel: "very_active",
        weeklyRate: -0.01,
      }),
    ).toMatchObject({
      maintenanceCalories: 4386,
      requestedAdjustment: -1650,
      appliedAdjustment: -1000,
      finalCalories: 3386,
      adjustmentCapApplied: true,
    });
  });

  it("caps a gain surplus at 500 kcal per day", () => {
    expect(
      calculateNutritionTarget({
        age: 30,
        sex: "male",
        weightKg: 150,
        heightCm: 190,
        activityLevel: "very_active",
        weeklyRate: 0.005,
      }),
    ).toMatchObject({
      requestedAdjustment: 825,
      appliedAdjustment: 500,
      finalCalories: 4886,
      adjustmentCapApplied: true,
    });
  });

  it("applies the male minimum calorie target", () => {
    expect(
      calculateNutritionTarget({
        age: 80,
        sex: "male",
        weightKg: 50,
        heightCm: 160,
        activityLevel: "sedentary",
        weeklyRate: 0,
      }),
    ).toMatchObject({
      finalCalories: 1500,
      floorApplied: true,
    });
  });
});
```

- [ ] **Step 3: Run the tests and verify the module is missing**

Run:

```bash
npm test -- src/lib/nutritionTargets.test.ts
```

Expected: FAIL because `./nutritionTargets` does not exist.

- [ ] **Step 4: Commit the test harness**

```bash
git add package.json package-lock.json src/lib/nutritionTargets.test.ts
git commit -m "test: add nutrition target test harness"
```

### Task 2: Implement adult targets, validation, macros, and unit conversion

**Files:**
- Create: `src/lib/nutritionTargets.ts`
- Modify: `src/lib/nutritionTargets.test.ts`
- Modify: `src/lib/macros.ts`

- [ ] **Step 1: Extend the tests for adult presets and shared helpers**

Append to `src/lib/nutritionTargets.test.ts`:

```ts
import {
  ACTIVITY_MULTIPLIERS,
  CUSTOM_RATE_LIMITS,
  DEFAULT_MACRO_PERCENTAGES,
  GOAL_RATE_PRESETS,
  calculateMacroGrams,
  cmToFtIn,
  ftInToCm,
  getBodyStatsValidationError,
  isValidImperialHeight,
  kgToLb,
  lbToKg,
  resolveStoredGoalMode,
  validateMacroPercentages,
} from "./nutritionTargets";

describe("adult target constants", () => {
  it("uses the approved activity multipliers", () => {
    expect(ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      very_active: 1.725,
    });
  });

  it("uses body-weight-relative loss and gain presets", () => {
    expect(GOAL_RATE_PRESETS).toEqual({
      lose_slow: -0.0025,
      lose: -0.005,
      lose_faster: -0.0075,
      maintain: 0,
      gain_slow: 0.001,
      gain: 0.0025,
      gain_faster: 0.005,
    });
    expect(CUSTOM_RATE_LIMITS).toEqual({
      lose: { min: 0.0025, max: 0.01 },
      gain: { min: 0.001, max: 0.005 },
    });
  });
});

describe("unit conversion", () => {
  it("round-trips kilograms and pounds without storing display rounding", () => {
    expect(lbToKg(kgToLb(70))).toBeCloseTo(70, 10);
  });

  it("normalizes rounded inches into the next foot", () => {
    expect(cmToFtIn(182.88)).toEqual({ feet: 6, inches: 0 });
    expect(ftInToCm(6, 0)).toBeCloseTo(182.88, 10);
  });

  it("rejects inches outside 0 through 11", () => {
    expect(isValidImperialHeight(5, 11)).toBe(true);
    expect(isValidImperialHeight(5, 12)).toBe(false);
  });
});

describe("validation and macros", () => {
  it("uses a 25/45/30 default and converts calories with 4/4/9", () => {
    expect(DEFAULT_MACRO_PERCENTAGES).toEqual({
      protein: 25,
      carbs: 45,
      fat: 30,
    });
    expect(
      calculateMacroGrams(2000, DEFAULT_MACRO_PERCENTAGES),
    ).toEqual({
      protein: 125,
      carbs: 225,
      fat: 67,
    });
  });

  it("requires macro percentages to total exactly 100", () => {
    expect(validateMacroPercentages({ protein: 25, carbs: 45, fat: 30 })).toBe(
      true,
    );
    expect(validateMacroPercentages({ protein: 30, carbs: 35, fat: 34 })).toBe(
      false,
    );
  });

  it("returns messages in the selected display system", () => {
    const input = {
      age: 30,
      sex: "male" as const,
      weightKg: 20,
      heightCm: 180,
      activityLevel: "moderate" as const,
      weeklyRate: 0,
    };
    expect(getBodyStatsValidationError(input, "metric")).toContain("30-300 kg");
    expect(getBodyStatsValidationError(input, "imperial")).toContain(
      "66-661 lb",
    );
  });

  it("rejects adult rates outside the supported range", () => {
    expect(() =>
      calculateNutritionTarget({ ...adultBase, weeklyRate: -0.0101 }),
    ).toThrow("Weekly rate must be between -1% and 0.5%.");
    expect(() =>
      calculateNutritionTarget({ ...adultBase, weeklyRate: 0.0051 }),
    ).toThrow("Weekly rate must be between -1% and 0.5%.");
  });

  it("loads missing goal metadata as a legacy custom target", () => {
    expect(resolveStoredGoalMode(null)).toBe("legacy_custom");
    expect(resolveStoredGoalMode("estimated_rate")).toBe("estimated_rate");
  });
});
```

Move the imports into one import block when editing the file.

- [ ] **Step 2: Create the adult implementation**

Create `src/lib/nutritionTargets.ts`:

```ts
export type BiologicalSex = "male" | "female";
export type UnitSystem = "metric" | "imperial";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "very_active";
export type GoalMode =
  | "estimated_rate"
  | "maintenance"
  | "custom_calories"
  | "minor_maintenance"
  | "legacy_custom";

export type NutritionTargetInput = {
  age: number;
  sex: BiologicalSex;
  weightKg: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  weeklyRate: number;
};

export type NutritionTargetResult = {
  maintenanceCalories: number;
  requestedRate: number | null;
  requestedAdjustment: number;
  appliedAdjustment: number;
  finalCalories: number;
  floorApplied: boolean;
  adjustmentCapApplied: boolean;
  calculationMethod: "mifflin_st_jeor" | "nasem_eer_2023";
};

export type MacroPercentages = {
  protein: number;
  carbs: number;
  fat: number;
};

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very_active: 1.725,
};

export const GOAL_RATE_PRESETS = {
  lose_slow: -0.0025,
  lose: -0.005,
  lose_faster: -0.0075,
  maintain: 0,
  gain_slow: 0.001,
  gain: 0.0025,
  gain_faster: 0.005,
} as const;

export const CUSTOM_RATE_LIMITS = {
  lose: { min: 0.0025, max: 0.01 },
  gain: { min: 0.001, max: 0.005 },
} as const;

export const CALORIE_FLOORS: Record<BiologicalSex, number> = {
  male: 1500,
  female: 1200,
};

export const STAT_LIMITS = {
  age: { min: 13, max: 100 },
  weightKg: { min: 30, max: 300 },
  heightCm: { min: 100, max: 250 },
  heightInchesPart: { min: 0, max: 11 },
} as const;

export const DEFAULT_MACRO_PERCENTAGES: MacroPercentages = {
  protein: 25,
  carbs: 45,
  fat: 30,
};

export const KCAL_PER_KG = 7700;
export const LB_PER_KG = 2.2046226218;

export function activityLevelFromStoredValue(value: unknown): ActivityLevel {
  if (
    value === "sedentary" ||
    value === "light" ||
    value === "moderate" ||
    value === "very_active"
  ) {
    return value;
  }

  const multiplier = Number(value);
  const match = (
    Object.entries(ACTIVITY_MULTIPLIERS) as [ActivityLevel, number][]
  ).find(([, candidate]) => Math.abs(candidate - multiplier) < 0.0001);
  return match?.[0] ?? "sedentary";
}

export function isGoalMode(value: unknown): value is GoalMode {
  return (
    value === "estimated_rate" ||
    value === "maintenance" ||
    value === "custom_calories" ||
    value === "minor_maintenance" ||
    value === "legacy_custom"
  );
}

export function resolveStoredGoalMode(value: unknown): GoalMode {
  return isGoalMode(value) ? value : "legacy_custom";
}

export function isUnitSystem(value: unknown): value is UnitSystem {
  return value === "metric" || value === "imperial";
}

export function calculateAdultMaintenance(input: NutritionTargetInput): number {
  const sexConstant = input.sex === "male" ? 5 : -161;
  const restingEnergy =
    10 * input.weightKg +
    6.25 * input.heightCm -
    5 * input.age +
    sexConstant;
  return restingEnergy * ACTIVITY_MULTIPLIERS[input.activityLevel];
}

function assertFiniteInRange(
  label: string,
  value: number,
  min: number,
  max: number,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${label} must be between ${min} and ${max}.`);
  }
}

export function getBodyStatsValidationError(
  input: NutritionTargetInput,
  unitSystem: UnitSystem,
): string | null {
  if (
    !Number.isFinite(input.age) ||
    input.age < STAT_LIMITS.age.min ||
    input.age > STAT_LIMITS.age.max
  ) {
    return "Age must be between 13 and 100 years.";
  }
  if (
    !Number.isFinite(input.weightKg) ||
    input.weightKg < STAT_LIMITS.weightKg.min ||
    input.weightKg > STAT_LIMITS.weightKg.max
  ) {
    return unitSystem === "metric"
      ? "Weight must be between 30-300 kg."
      : "Weight must be between 66-661 lb.";
  }
  if (
    !Number.isFinite(input.heightCm) ||
    input.heightCm < STAT_LIMITS.heightCm.min ||
    input.heightCm > STAT_LIMITS.heightCm.max
  ) {
    return unitSystem === "metric"
      ? "Height must be between 100-250 cm."
      : "Height must be between 3 ft 3 in and 8 ft 2 in.";
  }
  if (!Number.isFinite(input.weeklyRate)) {
    return "Weekly goal rate must be a valid number.";
  }
  return null;
}

function assertNutritionInput(input: NutritionTargetInput): void {
  assertFiniteInRange(
    "Age",
    input.age,
    STAT_LIMITS.age.min,
    STAT_LIMITS.age.max,
  );
  assertFiniteInRange(
    "Weight",
    input.weightKg,
    STAT_LIMITS.weightKg.min,
    STAT_LIMITS.weightKg.max,
  );
  assertFiniteInRange(
    "Height",
    input.heightCm,
    STAT_LIMITS.heightCm.min,
    STAT_LIMITS.heightCm.max,
  );
  if (!Number.isFinite(input.weeklyRate)) {
    throw new RangeError("Weekly rate must be finite.");
  }
  if (input.age >= 18 && (input.weeklyRate < -0.01 || input.weeklyRate > 0.005)) {
    throw new RangeError("Weekly rate must be between -1% and 0.5%.");
  }
}

function calculateAdultTarget(
  input: NutritionTargetInput,
): NutritionTargetResult {
  const rawMaintenance = calculateAdultMaintenance(input);
  const maintenanceCalories = Math.round(rawMaintenance);
  const rawRequestedAdjustment =
    (input.weightKg * input.weeklyRate * KCAL_PER_KG) / 7;
  const requestedAdjustment = Math.round(rawRequestedAdjustment);

  let cappedAdjustment = rawRequestedAdjustment;
  if (rawRequestedAdjustment < 0) {
    cappedAdjustment = -Math.min(
      Math.abs(rawRequestedAdjustment),
      rawMaintenance * 0.3,
      1000,
    );
  } else if (rawRequestedAdjustment > 0) {
    cappedAdjustment = Math.min(rawRequestedAdjustment, 500);
  }

  const adjustmentCapApplied =
    Math.abs(cappedAdjustment - rawRequestedAdjustment) > 0.01;
  const targetBeforeFloor = Math.round(rawMaintenance + cappedAdjustment);
  const finalCalories = Math.max(
    targetBeforeFloor,
    CALORIE_FLOORS[input.sex],
  );

  return {
    maintenanceCalories,
    requestedRate: input.weeklyRate,
    requestedAdjustment,
    appliedAdjustment: finalCalories - maintenanceCalories,
    finalCalories,
    floorApplied: finalCalories !== targetBeforeFloor,
    adjustmentCapApplied,
    calculationMethod: "mifflin_st_jeor",
  };
}

export function calculateNutritionTarget(
  input: NutritionTargetInput,
): NutritionTargetResult {
  assertNutritionInput(input);
  if (input.age < 18) {
    throw new RangeError("Minor EER calculation is not implemented yet.");
  }
  return calculateAdultTarget(input);
}

export function calculateMacroGrams(
  calories: number,
  percentages: MacroPercentages,
): { protein: number; carbs: number; fat: number } {
  if (!Number.isFinite(calories) || calories <= 0) {
    throw new RangeError("Calories must be a positive number.");
  }
  if (!validateMacroPercentages(percentages)) {
    throw new RangeError("Macro percentages must total exactly 100.");
  }
  return {
    protein: Math.round((calories * percentages.protein) / 100 / 4),
    carbs: Math.round((calories * percentages.carbs) / 100 / 4),
    fat: Math.round((calories * percentages.fat) / 100 / 9),
  };
}

export function validateMacroPercentages(
  percentages: MacroPercentages,
): boolean {
  return (
    Object.values(percentages).every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    ) &&
    percentages.protein + percentages.carbs + percentages.fat === 100
  );
}

export const lbToKg = (pounds: number): number => pounds / LB_PER_KG;
export const kgToLb = (kilograms: number): number => kilograms * LB_PER_KG;

export const ftInToCm = (feet: number, inches: number): number =>
  (feet * 12 + inches) * 2.54;

export function isValidImperialHeight(feet: number, inches: number): boolean {
  return (
    Number.isFinite(feet) &&
    feet >= 0 &&
    Number.isFinite(inches) &&
    inches >= STAT_LIMITS.heightInchesPart.min &&
    inches <= STAT_LIMITS.heightInchesPart.max
  );
}

export function cmToFtIn(cm: number): { feet: number; inches: number } {
  const roundedTotalInches = Math.round(cm / 2.54);
  return {
    feet: Math.floor(roundedTotalInches / 12),
    inches: roundedTotalInches % 12,
  };
}
```

- [ ] **Step 3: Remove nutrition-target exports from the food macro module**

Delete `src/lib/macros.ts` lines beginning at the current
`// TDEE / calorie-goal math` section through the end of the file. Keep
`Unit`, food types, `calcMacrosRaw`, `calcMacros`, `recipeTotal`,
`getUnitsToDisplay`, and `defaultWeightForUnit` unchanged.

The final export at the bottom of `src/lib/macros.ts` must be:

```ts
export function defaultWeightForUnit(unit: string): string {
  return unit === "g" || unit === "ml" ? "100" : "1";
}
```

- [ ] **Step 4: Run the adult tests**

Run:

```bash
npm test -- src/lib/nutritionTargets.test.ts
```

Expected: all adult, conversion, validation, and macro tests PASS.

- [ ] **Step 5: Commit the adult calculation module**

```bash
git add src/lib/nutritionTargets.ts src/lib/nutritionTargets.test.ts src/lib/macros.ts
git commit -m "feat: add shared adult nutrition targets"
```

### Task 3: Add maintenance-only adolescent EER calculations

**Files:**
- Modify: `src/lib/nutritionTargets.ts`
- Modify: `src/lib/nutritionTargets.test.ts`

- [ ] **Step 1: Write failing adolescent equation and age-boundary tests**

Append to `src/lib/nutritionTargets.test.ts`:

```ts
describe("calculateNutritionTarget for minors", () => {
  it.each([
    ["sedentary", 2364],
    ["light", 2485],
    ["moderate", 2733],
    ["very_active", 3024],
  ] as const)("uses the age-13 male %s EER equation", (activityLevel, expected) => {
    expect(
      calculateNutritionTarget({
        age: 13,
        sex: "male",
        weightKg: 50,
        heightCm: 160,
        activityLevel,
        weeklyRate: -0.01,
      }),
    ).toMatchObject({
      maintenanceCalories: expected,
      requestedRate: null,
      requestedAdjustment: 0,
      appliedAdjustment: 0,
      finalCalories: expected,
      calculationMethod: "nasem_eer_2023",
    });
  });

  it.each([
    ["sedentary", 1999],
    ["light", 2223],
    ["moderate", 2347],
    ["very_active", 2659],
  ] as const)("uses the age-13 female %s EER equation", (activityLevel, expected) => {
    expect(
      calculateNutritionTarget({
        age: 13,
        sex: "female",
        weightKg: 50,
        heightCm: 160,
        activityLevel,
        weeklyRate: 0.005,
      }),
    ).toMatchObject({
      maintenanceCalories: expected,
      requestedRate: null,
      finalCalories: expected,
      calculationMethod: "nasem_eer_2023",
    });
  });

  it("switches growth allowance at age 14", () => {
    expect(
      calculateNutritionTarget({
        age: 14,
        sex: "male",
        weightKg: 50,
        heightCm: 160,
        activityLevel: "sedentary",
        weeklyRate: 0,
      }).finalCalories,
    ).toBe(2363);
  });

  it("keeps age 17 on the adolescent path", () => {
    expect(
      calculateNutritionTarget({
        age: 17,
        sex: "female",
        weightKg: 50,
        heightCm: 160,
        activityLevel: "moderate",
        weeklyRate: 0,
      }),
    ).toMatchObject({
      finalCalories: 2248,
      calculationMethod: "nasem_eer_2023",
    });
  });

  it("uses the adult path at age 18", () => {
    expect(
      calculateNutritionTarget({
        age: 18,
        sex: "male",
        weightKg: 70,
        heightCm: 175,
        activityLevel: "sedentary",
        weeklyRate: 0,
      }).calculationMethod,
    ).toBe("mifflin_st_jeor");
  });
});
```

- [ ] **Step 2: Run the minor tests and verify the intentional failure**

Run:

```bash
npm test -- src/lib/nutritionTargets.test.ts
```

Expected: minor tests FAIL with
`Minor EER calculation is not implemented yet.`

- [ ] **Step 3: Implement the NASEM Table 5-15 equations**

Add above `calculateNutritionTarget` in `src/lib/nutritionTargets.ts`:

```ts
type EerCoefficients = {
  constant: number;
  age: number;
  height: number;
  weight: number;
};

const MINOR_EER_COEFFICIENTS: Record<
  BiologicalSex,
  Record<ActivityLevel, EerCoefficients>
> = {
  male: {
    sedentary: { constant: -447.51, age: 3.68, height: 13.01, weight: 13.15 },
    light: { constant: 19.12, age: 3.68, height: 8.62, weight: 20.28 },
    moderate: { constant: -388.19, age: 3.68, height: 12.66, weight: 20.46 },
    very_active: {
      constant: -671.75,
      age: 3.68,
      height: 15.38,
      weight: 23.25,
    },
  },
  female: {
    sedentary: { constant: 55.59, age: -22.25, height: 8.43, weight: 17.07 },
    light: { constant: -297.54, age: -22.25, height: 12.77, weight: 14.73 },
    moderate: {
      constant: -189.55,
      age: -22.25,
      height: 11.74,
      weight: 18.34,
    },
    very_active: {
      constant: -709.59,
      age: -22.25,
      height: 18.22,
      weight: 14.25,
    },
  },
};

function minorGrowthAllowance(age: number, sex: BiologicalSex): number {
  if (age === 13) return sex === "male" ? 25 : 30;
  return 20;
}

function calculateMinorTarget(
  input: NutritionTargetInput,
): NutritionTargetResult {
  const coefficients =
    MINOR_EER_COEFFICIENTS[input.sex][input.activityLevel];
  const maintenanceCalories = Math.round(
    coefficients.constant +
      coefficients.age * input.age +
      coefficients.height * input.heightCm +
      coefficients.weight * input.weightKg +
      minorGrowthAllowance(input.age, input.sex),
  );
  return {
    maintenanceCalories,
    requestedRate: null,
    requestedAdjustment: 0,
    appliedAdjustment: 0,
    finalCalories: maintenanceCalories,
    floorApplied: false,
    adjustmentCapApplied: false,
    calculationMethod: "nasem_eer_2023",
  };
}
```

Replace `calculateNutritionTarget` with:

```ts
export function calculateNutritionTarget(
  input: NutritionTargetInput,
): NutritionTargetResult {
  assertNutritionInput(input);
  return input.age < 18
    ? calculateMinorTarget(input)
    : calculateAdultTarget(input);
}
```

- [ ] **Step 4: Run the complete calculation test file**

Run:

```bash
npm test -- src/lib/nutritionTargets.test.ts
```

Expected: all tests PASS, including ages 13, 14, and 18.

- [ ] **Step 5: Commit the adolescent path**

```bash
git add src/lib/nutritionTargets.ts src/lib/nutritionTargets.test.ts
git commit -m "feat: add adolescent maintenance targets"
```

### Task 4: Add explicit goal metadata to Supabase

**Files:**
- Create: `supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql`
- Modify: `README.md`

- [ ] **Step 1: Create the non-destructive migration**

Create `supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql`:

```sql
alter table public.user_goals
  add column if not exists goal_mode text,
  add column if not exists goal_rate numeric,
  add column if not exists unit_system text;

alter table public.user_goals
  drop constraint if exists user_goals_goal_mode_check,
  add constraint user_goals_goal_mode_check
    check (
      goal_mode is null
      or goal_mode in (
        'estimated_rate',
        'maintenance',
        'custom_calories',
        'minor_maintenance',
        'legacy_custom'
      )
    );

alter table public.user_goals
  drop constraint if exists user_goals_goal_rate_check,
  add constraint user_goals_goal_rate_check
    check (goal_rate is null or goal_rate between -0.01 and 0.005);

alter table public.user_goals
  drop constraint if exists user_goals_unit_system_check,
  add constraint user_goals_unit_system_check
    check (unit_system is null or unit_system in ('metric', 'imperial'));
```

This migration intentionally leaves all three columns null on existing rows.

- [ ] **Step 2: Add migration instructions to the README**

Add this section after the current Supabase setup section in `README.md`:

```md
### Nutrition target migration

Apply `supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql`
before deploying the updated signup, profile, or dashboard screens. The
migration is non-destructive: existing calorie targets are preserved and rows
without metadata load as existing custom targets until the user selects a new
plan.
```

- [ ] **Step 3: Validate the SQL in a disposable or linked Supabase project**

Run from a Supabase CLI environment linked to the intended non-production
project:

```bash
npx supabase db push
```

Then run in the SQL editor:

```sql
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_goals'
  and column_name in ('goal_mode', 'goal_rate', 'unit_system')
order by column_name;
```

Expected: three nullable columns, with `goal_rate` reported as `numeric`.

- [ ] **Step 4: Commit the migration**

```bash
git add supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql README.md
git commit -m "feat: persist nutrition goal metadata"
```

### Task 5: Add shared nutrition presentation components

**Files:**
- Create: `src/components/nutrition/UnitSystemToggle.tsx`
- Create: `src/components/nutrition/TargetBreakdown.tsx`

- [ ] **Step 1: Create the shared unit-system control**

Create `src/components/nutrition/UnitSystemToggle.tsx`:

```tsx
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors } from "@/src/styles/colors";
import type { UnitSystem } from "@/src/lib/nutritionTargets";

type Props = {
  value: UnitSystem;
  onChange: (value: UnitSystem) => void;
};

export function UnitSystemToggle({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {(["metric", "imperial"] as const).map((unit) => {
        const active = value === unit;
        return (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={unit}
            onPress={() => onChange(unit)}
            style={[styles.button, active && styles.activeButton]}
          >
            <Text style={[styles.text, active && styles.activeText]}>
              {unit === "metric" ? "Metric (kg/cm)" : "Imperial (lb/ft)"}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  button: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  activeButton: {
    backgroundColor: Colors.accent,
  },
  text: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  activeText: {
    color: Colors.textOnAccent,
  },
});
```

- [ ] **Step 2: Create the transparent target breakdown**

Create `src/components/nutrition/TargetBreakdown.tsx`:

```tsx
import { StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/styles/colors";
import {
  kgToLb,
  type NutritionTargetResult,
  type UnitSystem,
} from "@/src/lib/nutritionTargets";

type Props = {
  result: NutritionTargetResult;
  weightKg: number;
  unitSystem: UnitSystem;
};

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

export function TargetBreakdown({ result, weightKg, unitSystem }: Props) {
  const weeklyKg = weightKg * (result.requestedRate ?? 0);
  const weeklyDisplay =
    unitSystem === "metric" ? weeklyKg : kgToLb(weeklyKg);
  const weeklyUnit = unitSystem === "metric" ? "kg" : "lb";

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Text style={styles.label}>Estimated maintenance</Text>
        <Text style={styles.value}>{result.maintenanceCalories} kcal</Text>
      </View>
      {result.requestedRate !== null && (
        <View style={styles.row}>
          <Text style={styles.label}>Selected rate</Text>
          <Text style={styles.value}>
            {signed(Number((result.requestedRate * 100).toFixed(2)))}% / week (
            {signed(Number(weeklyDisplay.toFixed(2)))} {weeklyUnit})
          </Text>
        </View>
      )}
      <View style={styles.row}>
        <Text style={styles.label}>Requested adjustment</Text>
        <Text style={styles.value}>
          {signed(result.requestedAdjustment)} kcal/day
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Applied adjustment</Text>
        <Text style={styles.value}>
          {signed(result.appliedAdjustment)} kcal/day
        </Text>
      </View>
      <View style={styles.targetRow}>
        <Text style={styles.targetLabel}>Daily target</Text>
        <Text style={styles.target}>{result.finalCalories} kcal</Text>
      </View>
      {(result.adjustmentCapApplied || result.floorApplied) && (
        <Text style={styles.notice}>
          TrackBing adjusted the requested plan to stay within the configured
          calorie safeguards.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 9,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  label: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
  },
  value: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  targetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  targetLabel: {
    color: Colors.text,
    fontWeight: "800",
  },
  target: {
    color: Colors.accent,
    fontSize: 22,
    fontWeight: "900",
  },
  notice: {
    color: "#f59e0b",
    fontSize: 12,
    lineHeight: 17,
  },
});
```

- [ ] **Step 3: Type-check the shared components**

Run:

```bash
npm run typecheck
```

Expected: failures may remain in the existing `ProfileScreen.tsx` draft, but
there must be no error in either new component.

- [ ] **Step 4: Commit the shared controls**

```bash
git add src/components/nutrition/UnitSystemToggle.tsx src/components/nutrition/TargetBreakdown.tsx
git commit -m "feat: add nutrition target controls"
```

### Task 6: Move signup to the shared adult/minor model

**Files:**
- Modify: `src/screens/AuthScreen.tsx`
- Modify: `src/styles/auth.ts`

- [ ] **Step 1: Replace signup nutrition imports and state**

Replace the `@/src/lib/macros` import with:

```ts
import {
  ACTIVITY_MULTIPLIERS,
  DEFAULT_MACRO_PERCENTAGES,
  GOAL_RATE_PRESETS,
  calculateMacroGrams,
  calculateNutritionTarget,
  cmToFtIn,
  ftInToCm,
  getBodyStatsValidationError,
  isValidImperialHeight,
  kgToLb,
  lbToKg,
  type ActivityLevel,
  type NutritionTargetResult,
  type UnitSystem,
} from "@/src/lib/nutritionTargets";
import { UnitSystemToggle } from "@/src/components/nutrition/UnitSystemToggle";
import { TargetBreakdown } from "@/src/components/nutrition/TargetBreakdown";
```

Replace the signup body and target state with:

```ts
const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");
const [gender, setGender] = useState<"male" | "female">("male");
const [age, setAge] = useState("");
const [weightKg, setWeightKg] = useState("");
const [weightLb, setWeightLb] = useState("");
const [heightCm, setHeightCm] = useState("");
const [heightFt, setHeightFt] = useState("");
const [heightIn, setHeightIn] = useState("");
const [activityLevel, setActivityLevel] =
  useState<ActivityLevel>("sedentary");
const [goalRate, setGoalRate] = useState<number>(
  GOAL_RATE_PRESETS.maintain,
);
const [targetResult, setTargetResult] =
  useState<NutritionTargetResult | null>(null);
```

- [ ] **Step 2: Replace `handleCalculate` with canonical parsing**

Use:

```ts
const handleCalculate = () => {
  const parsedAge = Number(age);
  const parsedInches = Number(heightIn);
  const canonicalWeight = Number(weightKg);
  const canonicalHeight = Number(heightCm);
  const isMinor = parsedAge >= 13 && parsedAge < 18;
  const input = {
    age: parsedAge,
    sex: gender,
    weightKg: canonicalWeight,
    heightCm: canonicalHeight,
    activityLevel,
    weeklyRate: isMinor ? 0 : goalRate,
  };

  if (unitSystem === "imperial" && (!Number.isFinite(parsedInches) || parsedInches < 0 || parsedInches > 11)) {
    showAlert("Invalid Height", "Inches must be between 0 and 11.");
    return;
  }

  const validationError = getBodyStatsValidationError(input, unitSystem);
  if (validationError) {
    showAlert("Invalid Stats", validationError);
    return;
  }

  try {
    const result = calculateNutritionTarget(input);
    setTargetResult(result);
    setStep(2);
  } catch (error) {
    showAlert(
      "Unable to Calculate",
      error instanceof Error ? error.message : "Check your stats and try again.",
    );
  }
};
```

- [ ] **Step 3: Add conversion handlers that keep metric values canonical**

Add:

```ts
const parseDisplay = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundDisplay = (value: number | null) =>
  value === null ? "" : String(Math.round(value * 10) / 10);

const handleWeightKgChange = (value: string) => {
  setWeightKg(value);
  const parsed = parseDisplay(value);
  setWeightLb(roundDisplay(parsed === null ? null : kgToLb(parsed)));
};

const handleWeightLbChange = (value: string) => {
  setWeightLb(value);
  const parsed = parseDisplay(value);
  setWeightKg(roundDisplay(parsed === null ? null : lbToKg(parsed)));
};

const updateImperialHeight = (feetText: string, inchesText: string) => {
  const feet = parseDisplay(feetText);
  const inches = parseDisplay(inchesText);
  if (
    feet !== null &&
    inches !== null &&
    isValidImperialHeight(feet, inches)
  ) {
    setHeightCm(roundDisplay(ftInToCm(feet, inches)));
  }
};

const handleHeightFtChange = (value: string) => {
  setHeightFt(value);
  updateImperialHeight(value, heightIn);
};

const handleHeightInChange = (value: string) => {
  setHeightIn(value);
  updateImperialHeight(heightFt, value);
};

const switchSignupUnitSystem = (next: UnitSystem) => {
  if (next === "imperial") {
    const parsedHeight = parseDisplay(heightCm);
    const convertedHeight =
      parsedHeight === null ? null : cmToFtIn(parsedHeight);
    setHeightFt(convertedHeight ? String(convertedHeight.feet) : "");
    setHeightIn(convertedHeight ? String(convertedHeight.inches) : "");
    const parsedWeight = parseDisplay(weightKg);
    setWeightLb(
      roundDisplay(parsedWeight === null ? null : kgToLb(parsedWeight)),
    );
  }
  setUnitSystem(next);
};
```

- [ ] **Step 4: Add metric/imperial signup fields and minor-only messaging**

At the top of the stats form body, render:

```tsx
<View style={styles.unitSection}>
  <UnitSystemToggle value={unitSystem} onChange={switchSignupUnitSystem} />
</View>
```

Use the canonical/display handlers in the weight input:

```tsx
<TextInput
  placeholder={unitSystem === "metric" ? "70" : "154"}
  keyboardType="numeric"
  value={unitSystem === "metric" ? weightKg : weightLb}
  onChangeText={
    unitSystem === "metric" ? handleWeightKgChange : handleWeightLbChange
  }
  placeholderTextColor={Colors.border}
  style={styles.statValueInput}
/>
```

Replace the weight suffix with:

```tsx
<Text style={styles.statUnitText}>
  {unitSystem === "metric" ? "kg" : "lb"}
</Text>
```

Replace the height input with:

```tsx
{unitSystem === "metric" ? (
  <View style={styles.statValueRow}>
    <TextInput
      placeholder="175"
      keyboardType="numeric"
      value={heightCm}
      onChangeText={setHeightCm}
      placeholderTextColor={Colors.border}
      style={styles.statValueInput}
    />
    <Text style={styles.statUnitText}>cm</Text>
  </View>
) : (
  <View style={styles.imperialHeightRow}>
    <View style={styles.imperialHeightField}>
      <TextInput
        placeholder="5"
        keyboardType="numeric"
        value={heightFt}
        onChangeText={handleHeightFtChange}
        placeholderTextColor={Colors.border}
        style={styles.statValueInput}
      />
      <Text style={styles.statUnitText}>ft</Text>
    </View>
    <View style={styles.imperialHeightField}>
      <TextInput
        placeholder="9"
        keyboardType="numeric"
        value={heightIn}
        onChangeText={handleHeightInChange}
        placeholderTextColor={Colors.border}
        style={styles.statValueInput}
      />
      <Text style={styles.statUnitText}>in</Text>
    </View>
  </View>
)}
```

Derive:

```ts
const parsedAge = Number(age);
const isMinor = Number.isFinite(parsedAge) && parsedAge >= 13 && parsedAge < 18;
```

When `isMinor` is true, replace goal chips with:

```tsx
<View style={styles.minorNotice}>
  <Text style={styles.minorNoticeTitle}>Maintain for healthy growth</Text>
  <Text style={styles.minorNoticeText}>
    TrackBing estimates maintenance only for ages 13-17. Weight-change plans
    for children and teens should be set with a qualified health professional.
  </Text>
</View>
```

For adults, render all approved presets:

```ts
const signupGoalOptions = [
  { label: "Lose Slowly", sub: "-0.25% / wk", value: GOAL_RATE_PRESETS.lose_slow },
  { label: "Lose", sub: "-0.50% / wk", value: GOAL_RATE_PRESETS.lose },
  { label: "Lose Faster", sub: "-0.75% / wk", value: GOAL_RATE_PRESETS.lose_faster },
  { label: "Maintain", sub: "0% / wk", value: GOAL_RATE_PRESETS.maintain },
  { label: "Gain Slowly", sub: "+0.10% / wk", value: GOAL_RATE_PRESETS.gain_slow },
  { label: "Gain", sub: "+0.25% / wk", value: GOAL_RATE_PRESETS.gain },
  { label: "Gain Faster", sub: "+0.50% / wk", value: GOAL_RATE_PRESETS.gain_faster },
];
```

Use `activityLevel` keys in activity buttons and display the multiplier from
`ACTIVITY_MULTIPLIERS[item.value]`.

Below the goal section, render this limitation notice:

```tsx
<Text style={styles.calculatorNotice}>
  This estimate is not designed for pregnancy, breastfeeding, eating-disorder
  treatment or recovery, or clinician-managed nutrition therapy.
</Text>
```

- [ ] **Step 5: Show the calculated breakdown before authentication**

Replace the current `calculatedCalories` result card with:

```tsx
{!isLogin && targetResult && (
  <TargetBreakdown
    result={targetResult}
    weightKg={Number(weightKg)}
    unitSystem={unitSystem}
  />
)}
```

- [ ] **Step 6: Persist canonical values, goal metadata, and initial macros**

In `handleVerify`, calculate:

```ts
if (!targetResult) {
  showAlert("Missing Target", "Return to the target step and calculate again.");
  setLoading(false);
  return;
}

const macroGrams = calculateMacroGrams(
  targetResult.finalCalories,
  DEFAULT_MACRO_PERCENTAGES,
);
const numericAge = Number(age);
const minor = numericAge < 18;
const savedMode = minor
  ? "minor_maintenance"
  : goalRate === 0
    ? "maintenance"
    : "estimated_rate";
```

Use this insert payload:

```ts
{
  user_id: data.session.user.id,
  calorie_target: targetResult.finalCalories,
  current_weight: Number(weightKg),
  height: Number(heightCm),
  age: numericAge,
  gender,
  activity_level: ACTIVITY_MULTIPLIERS[activityLevel].toString(),
  goal_mode: savedMode,
  goal_rate: minor || goalRate === 0 ? null : goalRate,
  unit_system: unitSystem,
  protein_ratio: DEFAULT_MACRO_PERCENTAGES.protein,
  carbs_ratio: DEFAULT_MACRO_PERCENTAGES.carbs,
  fat_ratio: DEFAULT_MACRO_PERCENTAGES.fat,
  protein_grams: macroGrams.protein,
  carbs_grams: macroGrams.carbs,
  fat_grams: macroGrams.fat,
}
```

If the insert fails, show `showAlert("Profile Setup Failed", dbError.message)`
and do not silently continue.

- [ ] **Step 7: Add the signup styles**

Add to `AuthStyles` in `src/styles/auth.ts`:

```ts
unitSection: {
  marginBottom: 16,
},
imperialHeightRow: {
  flexDirection: "row",
  gap: 12,
},
imperialHeightField: {
  flex: 1,
  flexDirection: "row",
  alignItems: "flex-end",
  gap: 3,
},
minorNotice: {
  padding: 16,
  marginBottom: 24,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: Colors.border,
  backgroundColor: Colors.inputBg,
},
minorNoticeTitle: {
  color: Colors.accent,
  fontSize: 15,
  fontWeight: "800",
  marginBottom: 6,
},
minorNoticeText: {
  color: Colors.textSecondary,
  fontSize: 13,
  lineHeight: 19,
},
calculatorNotice: {
  color: Colors.textMuted,
  fontSize: 11,
  lineHeight: 17,
  marginBottom: 18,
},
```

- [ ] **Step 8: Verify and commit signup**

Run:

```bash
npm run typecheck
npm test -- src/lib/nutritionTargets.test.ts
```

Expected: nutrition tests PASS. Resolve all `AuthScreen.tsx` type errors before
committing; existing Profile draft errors may remain until Tasks 7 and 8.

```bash
git add src/screens/AuthScreen.tsx src/styles/auth.ts
git commit -m "feat: use shared nutrition targets at signup"
```

### Task 7: Replace Profile's inferred goal state with persisted intent

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`

- [ ] **Step 1: Replace Profile nutrition imports and state**

Import:

```ts
import {
  ACTIVITY_MULTIPLIERS,
  CUSTOM_RATE_LIMITS,
  DEFAULT_MACRO_PERCENTAGES,
  GOAL_RATE_PRESETS,
  activityLevelFromStoredValue,
  calculateMacroGrams,
  calculateNutritionTarget,
  cmToFtIn,
  ftInToCm,
  getBodyStatsValidationError,
  isUnitSystem,
  kgToLb,
  lbToKg,
  resolveStoredGoalMode,
  validateMacroPercentages,
  type ActivityLevel,
  type GoalMode,
  type NutritionTargetResult,
  type UnitSystem,
} from "@/src/lib/nutritionTargets";
import { UnitSystemToggle } from "@/src/components/nutrition/UnitSystemToggle";
import { TargetBreakdown } from "@/src/components/nutrition/TargetBreakdown";
```

Remove all nutrition imports from `@/src/lib/macros`.

Replace activity and goal state with:

```ts
const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");
const [activityLevel, setActivityLevel] =
  useState<ActivityLevel>("sedentary");
const [goalMode, setGoalMode] = useState<GoalMode>("legacy_custom");
const [goalRate, setGoalRate] = useState<number>(0);
const [targetResult, setTargetResult] =
  useState<NutritionTargetResult | null>(null);
const [calories, setCalories] = useState(0);
const [profileError, setProfileError] = useState("");
```

Initialize macro strings with:

```ts
const [pRatio, setPRatio] = useState(
  DEFAULT_MACRO_PERCENTAGES.protein.toString(),
);
const [cRatio, setCRatio] = useState(
  DEFAULT_MACRO_PERCENTAGES.carbs.toString(),
);
const [fRatio, setFRatio] = useState(
  DEFAULT_MACRO_PERCENTAGES.fat.toString(),
);
```

- [ ] **Step 2: Replace profile loading and remove calorie back-calculation**

Use this metadata mapping inside `fetchProfile`:

```ts
const loadedUnitSystem = isUnitSystem(data.unit_system)
  ? data.unit_system
  : "metric";
const loadedActivity = activityLevelFromStoredValue(data.activity_level);
const loadedAge = Number(data.age);
const loadedWeight = Number(data.current_weight);
const loadedHeight = Number(data.height);
const loadedMode = resolveStoredGoalMode(data.goal_mode);
const loadedRate = Number(data.goal_rate);

setUnitSystem(loadedUnitSystem);
setActivityLevel(loadedActivity);
setGoalMode(loadedMode);
setGoalRate(Number.isFinite(loadedRate) ? loadedRate : 0);
setCalories(Number(data.calorie_target) || 0);
setPRatio(
  String(data.protein_ratio ?? DEFAULT_MACRO_PERCENTAGES.protein),
);
setCRatio(String(data.carbs_ratio ?? DEFAULT_MACRO_PERCENTAGES.carbs));
setFRatio(String(data.fat_ratio ?? DEFAULT_MACRO_PERCENTAGES.fat));

if (loadedUnitSystem === "imperial") {
  setWeightLb(kgToLb(loadedWeight).toFixed(1));
  setTargetWeightLb(
    data.target_weight ? kgToLb(Number(data.target_weight)).toFixed(1) : "",
  );
  const convertedHeight = cmToFtIn(loadedHeight);
  setHeightFt(String(convertedHeight.feet));
  setHeightIn(String(convertedHeight.inches));
}

if (
  loadedMode === "estimated_rate" ||
  loadedMode === "maintenance" ||
  loadedMode === "minor_maintenance"
) {
  const result = calculateNutritionTarget({
    age: loadedAge,
    sex: data.gender === "female" ? "female" : "male",
    weightKg: loadedWeight,
    heightCm: loadedHeight,
    activityLevel: loadedActivity,
    weeklyRate:
      loadedMode === "minor_maintenance"
        ? 0
        : Number.isFinite(loadedRate)
          ? loadedRate
          : 0,
  });
  setTargetResult(result);
  setCalories(result.finalCalories);
} else {
  setTargetResult(null);
}
```

Destructure the profile query as `{ data, error }`. For Supabase fetch errors:

```ts
if (error) {
  setProfileError(error.message);
  return;
}
```

Render the fetch error above the cards:

```tsx
{profileError ? (
  <View style={styles.errorBox}>
    <Text style={styles.errorText}>{profileError}</Text>
  </View>
) : null}
```

Delete the old derived-offset calculation entirely. A null `goal_mode` must
never select a preset chip.

- [ ] **Step 3: Add one calculation function for all live changes**

Add:

```ts
const recalculateEstimatedTarget = (overrides: {
  weightKg?: number;
  heightCm?: number;
  age?: number;
  sex?: "male" | "female";
  activityLevel?: ActivityLevel;
  weeklyRate?: number;
  goalMode?: GoalMode;
} = {}) => {
  const nextAge = overrides.age ?? Number(age);
  const requestedMode = overrides.goalMode ?? goalMode;
  const nextMode: GoalMode =
    nextAge < 18
      ? "minor_maintenance"
      : requestedMode === "minor_maintenance"
        ? "maintenance"
        : requestedMode;
  if (nextMode === "legacy_custom" || nextMode === "custom_calories") {
    return;
  }

  const input = {
    age: nextAge,
    sex: overrides.sex ?? (gender === "female" ? "female" : "male"),
    weightKg: overrides.weightKg ?? Number(weight),
    heightCm: overrides.heightCm ?? Number(height),
    activityLevel: overrides.activityLevel ?? activityLevel,
    weeklyRate:
      nextMode === "maintenance"
        ? 0
        : overrides.weeklyRate ?? goalRate,
  };

  if (getBodyStatsValidationError(input, unitSystem)) return;
  const result = calculateNutritionTarget(input);
  setGoalMode(nextMode);
  setGoalRate(nextMode === "minor_maintenance" ? 0 : input.weeklyRate);
  setTargetResult(result);
  setCalories(result.finalCalories);
};
```

Every stat, sex, and activity handler must update canonical state first and
call this function with the changed value. For legacy/custom rows, values may
change without replacing the saved calorie target until a new plan is selected.

- [ ] **Step 4: Commit the loading and state replacement**

Run:

```bash
npm run typecheck
```

Expected: no references remain to `calculateBMR`, `calculateTDEE`,
`calculateGoalCalories`, or `KCAL_PER_KG` in `ProfileScreen.tsx`. UI errors for
styles being replaced in Task 8 are acceptable only until that task.

```bash
git add src/screens/ProfileScreen.tsx
git commit -m "refactor: load explicit profile goal intent"
```

### Task 8: Finish Profile units, adult/minor goal UX, validation, and saving

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`

- [ ] **Step 1: Use the shared unit toggle and canonical conversion handlers**

Replace Profile's local unit toggle markup with:

```tsx
<UnitSystemToggle value={unitSystem} onChange={switchUnitSystem} />
```

Keep canonical `weight`, `targetWeight`, and `height` values in kg/cm. On
imperial input, reject inches outside `0-11` before save. The switch handler
must derive display values from canonical values and must not convert an
already rounded display value back into canonical storage.

- [ ] **Step 2: Replace the goal card with explicit adult/minor/legacy states**

Define:

```ts
const isMinor = Number(age) >= 13 && Number(age) < 18;
const goalChips = [
  { label: "Lose 0.25%", rate: GOAL_RATE_PRESETS.lose_slow },
  { label: "Lose 0.50%", rate: GOAL_RATE_PRESETS.lose },
  { label: "Lose 0.75%", rate: GOAL_RATE_PRESETS.lose_faster },
  { label: "Maintain", rate: GOAL_RATE_PRESETS.maintain },
  { label: "Gain 0.10%", rate: GOAL_RATE_PRESETS.gain_slow },
  { label: "Gain 0.25%", rate: GOAL_RATE_PRESETS.gain },
  { label: "Gain 0.50%", rate: GOAL_RATE_PRESETS.gain_faster },
];

const selectGoalRate = (rate: number) => {
  const nextMode: GoalMode = rate === 0 ? "maintenance" : "estimated_rate";
  setGoalMode(nextMode);
  setGoalRate(rate);
  setUseCustomRate(false);
  recalculateEstimatedTarget({ weeklyRate: rate, goalMode: nextMode });
};

const activateMinorMaintenance = () => {
  setGoalMode("minor_maintenance");
  setGoalRate(0);
  recalculateEstimatedTarget({
    weeklyRate: 0,
    goalMode: "minor_maintenance",
  });
};
```

For minors, render:

```tsx
<View style={styles.noticeBox}>
  <Text style={styles.noticeTitle}>Maintain for healthy growth</Text>
  <Text style={styles.noticeText}>
    TrackBing does not provide loss, gain, or custom calorie plans for ages
    13-17. Ask a qualified health professional about weight-change goals.
  </Text>
  {goalMode === "legacy_custom" && (
    <TouchableOpacity
      onPress={activateMinorMaintenance}
      style={styles.noticeAction}
    >
      <Text style={styles.noticeActionText}>Use maintenance estimate</Text>
    </TouchableOpacity>
  )}
</View>
```

For `legacy_custom`, render:

```tsx
<View style={styles.noticeBox}>
  <Text style={styles.noticeTitle}>Existing custom target</Text>
  <Text style={styles.noticeText}>
    Your saved {calories} kcal target is unchanged. Select a plan below to
    replace it with a new estimate.
  </Text>
</View>
```

For `custom_calories`, use the same box with title `Custom calorie target`.

Render adult chips only when `!isMinor`. Render custom-rate inputs only for
adults, and reject loss outside `0.25-1.0%` or gain outside `0.1-0.5%` before
applying:

```ts
const applyCustomRate = () => {
  const percent = Number(customPercent);
  const limits =
    customDir === "lose" ? CUSTOM_RATE_LIMITS.lose : CUSTOM_RATE_LIMITS.gain;
  const magnitude = percent / 100;
  if (!Number.isFinite(percent) || magnitude < limits.min || magnitude > limits.max) {
    showMessage(
      "Invalid Rate",
      customDir === "lose"
        ? "Loss rate must be between 0.25% and 1.0% per week."
        : "Gain rate must be between 0.1% and 0.5% per week.",
    );
    return;
  }
  const signedRate = customDir === "lose" ? -magnitude : magnitude;
  setGoalMode("estimated_rate");
  setGoalRate(signedRate);
  recalculateEstimatedTarget({
    weeklyRate: signedRate,
    goalMode: "estimated_rate",
  });
};
```

Place this button below the custom direction and percentage inputs:

```tsx
<TouchableOpacity onPress={applyCustomRate} style={styles.customApplyButton}>
  <Text style={styles.customApplyText}>Apply custom rate</Text>
</TouchableOpacity>
```

At the bottom of the goal card, render:

```tsx
<Text style={styles.calculatorNotice}>
  Estimates are not intended for pregnancy, breastfeeding, eating-disorder
  treatment or recovery, or clinician-managed nutrition therapy.
</Text>
```

- [ ] **Step 3: Render the target breakdown**

When `targetResult` exists:

```tsx
<TargetBreakdown
  result={targetResult}
  weightKg={Number(weight)}
  unitSystem={unitSystem}
/>
```

When no result exists, show the preserved `calories` value without inventing
maintenance or rate details.

- [ ] **Step 4: Replace macro calculation with the shared helper**

Use:

```ts
useEffect(() => {
  const percentages = {
    protein: Number(pRatio),
    carbs: Number(cRatio),
    fat: Number(fRatio),
  };
  if (calories > 0 && validateMacroPercentages(percentages)) {
    const grams = calculateMacroGrams(calories, percentages);
    setProteinGrams(grams.protein);
    setCarbsGrams(grams.carbs);
    setFatGrams(grams.fat);
  }
}, [calories, pRatio, cRatio, fRatio]);
```

- [ ] **Step 5: Replace `handleSave` validation and persistence**

Before saving, build:

```ts
const bodyInput = {
  age: Number(age),
  sex: gender === "female" ? ("female" as const) : ("male" as const),
  weightKg: Number(weight),
  heightCm: Number(height),
  activityLevel,
  weeklyRate: isMinor ? 0 : goalRate,
};
const bodyError = getBodyStatsValidationError(bodyInput, unitSystem);
if (bodyError) return showMessage("Invalid Stats", bodyError);
const savedTargetWeight = Number(targetWeight);
if (
  !Number.isFinite(savedTargetWeight) ||
  savedTargetWeight < 30 ||
  savedTargetWeight > 300
) {
  return showMessage(
    "Invalid Target",
    unitSystem === "metric"
      ? "Target weight must be between 30-300 kg."
      : "Target weight must be between 66-661 lb.",
  );
}
if (
  unitSystem === "imperial" &&
  (Number(heightIn) < 0 || Number(heightIn) > 11)
) {
  return showMessage("Invalid Height", "Inches must be between 0 and 11.");
}

const percentages = {
  protein: Number(pRatio),
  carbs: Number(cRatio),
  fat: Number(fRatio),
};
if (!validateMacroPercentages(percentages)) {
  return showMessage("Macro Error", "Macro percentages must total exactly 100%.");
}

const savedCalories = targetResult?.finalCalories ?? calories;
const grams = calculateMacroGrams(savedCalories, percentages);
```

Use this payload:

```ts
const updates: Record<string, string | number | null> = {
  user_id: user.id,
  current_weight: bodyInput.weightKg,
  target_weight: savedTargetWeight,
  height: bodyInput.heightCm,
  age: bodyInput.age,
  gender: bodyInput.sex,
  activity_level: ACTIVITY_MULTIPLIERS[activityLevel].toString(),
  calorie_target: savedCalories,
  unit_system: unitSystem,
  protein_ratio: percentages.protein,
  carbs_ratio: percentages.carbs,
  fat_ratio: percentages.fat,
  protein_grams: grams.protein,
  carbs_grams: grams.carbs,
  fat_grams: grams.fat,
};

if (goalMode !== "legacy_custom") {
  updates.goal_mode = isMinor ? "minor_maintenance" : goalMode;
  updates.goal_rate =
    isMinor || goalMode === "maintenance" || goalMode === "custom_calories"
      ? null
      : goalRate;
}
```

This intentionally omits `goal_mode` and `goal_rate` for untouched legacy
rows, so their null metadata remains null.

- [ ] **Step 6: Add all styles referenced by the new goal UI**

Add to Profile's `StyleSheet.create`:

```ts
noticeBox: {
  padding: 14,
  marginBottom: 14,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: Colors.border,
  backgroundColor: Colors.inputBg,
},
noticeTitle: {
  color: Colors.accent,
  fontSize: 14,
  fontWeight: "800",
  marginBottom: 5,
},
noticeText: {
  color: Colors.textSecondary,
  fontSize: 12,
  lineHeight: 18,
},
noticeAction: {
  alignItems: "center",
  paddingVertical: 10,
  marginTop: 12,
  borderRadius: 10,
  backgroundColor: Colors.accent,
},
noticeActionText: {
  color: Colors.textOnAccent,
  fontSize: 12,
  fontWeight: "800",
},
errorBox: {
  padding: 12,
  marginBottom: 14,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#ef4444",
  backgroundColor: "rgba(239,68,68,0.12)",
},
errorText: {
  color: "#fca5a5",
  fontSize: 12,
  lineHeight: 17,
},
customToggle: {
  alignItems: "center",
  paddingVertical: 11,
  marginBottom: 10,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: Colors.border,
  backgroundColor: Colors.inputBg,
},
customToggleActive: {
  borderColor: Colors.accentBlue,
},
customToggleText: {
  color: Colors.textSecondary,
  fontSize: 12,
  fontWeight: "700",
},
customBlock: {
  gap: 10,
  padding: 12,
  marginBottom: 14,
  borderRadius: 12,
  backgroundColor: Colors.inputBg,
},
customDirRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},
customDirBtn: {
  paddingVertical: 10,
  paddingHorizontal: 14,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: Colors.border,
},
customDirActive: {
  backgroundColor: Colors.accent,
  borderColor: Colors.accent,
},
customDirText: {
  color: Colors.textSecondary,
  fontWeight: "700",
},
customPctWrap: {
  flex: 1,
  flexDirection: "row",
  alignItems: "center",
  borderRadius: 10,
  borderWidth: 1,
  borderColor: Colors.border,
},
customPctInput: {
  flex: 1,
  color: Colors.text,
  paddingVertical: 10,
  paddingHorizontal: 12,
  textAlign: "right",
  fontWeight: "700",
},
customPctUnit: {
  color: Colors.textMuted,
  paddingRight: 10,
  fontSize: 12,
},
customHint: {
  color: Colors.textMuted,
  fontSize: 11,
  lineHeight: 16,
},
customApplyButton: {
  alignItems: "center",
  paddingVertical: 10,
  borderRadius: 10,
  backgroundColor: Colors.accent,
},
customApplyText: {
  color: Colors.textOnAccent,
  fontSize: 12,
  fontWeight: "800",
},
calculatorNotice: {
  color: Colors.textMuted,
  fontSize: 11,
  lineHeight: 17,
  marginTop: 12,
},
```

Remove the obsolete local `unitToggle*` and `floorWarning` styles after their
markup is gone.

- [ ] **Step 7: Verify and commit Profile**

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Expected: typecheck PASS, tests PASS, and lint has no new warnings from
`ProfileScreen.tsx`.

```bash
git add src/screens/ProfileScreen.tsx
git commit -m "feat: add explicit diet target editing"
```

### Task 9: Make the dashboard calorie editor an adult custom target

**Files:**
- Modify: `src/screens/DashboardScreen.tsx`

- [ ] **Step 1: Import shared floor and macro helpers**

Add:

```ts
import {
  CALORIE_FLOORS,
  DEFAULT_MACRO_PERCENTAGES,
  calculateMacroGrams,
  validateMacroPercentages,
} from "@/src/lib/nutritionTargets";
```

- [ ] **Step 2: Load age, sex, ratios, and goal mode with dashboard goals**

Change the `user_goals` select to:

```ts
.select(
  "calorie_target, protein_grams, carbs_grams, fat_grams, protein_ratio, carbs_ratio, fat_ratio, age, gender, goal_mode",
)
```

Store the loaded profile data:

```ts
const [goalProfile, setGoalProfile] = useState<{
  age: number;
  gender: "male" | "female";
  proteinRatio: number;
  carbsRatio: number;
  fatRatio: number;
} | null>(null);
```

After loading:

```ts
const percentages = {
  protein:
    Number(userGoal.protein_ratio) || DEFAULT_MACRO_PERCENTAGES.protein,
  carbs: Number(userGoal.carbs_ratio) || DEFAULT_MACRO_PERCENTAGES.carbs,
  fat: Number(userGoal.fat_ratio) || DEFAULT_MACRO_PERCENTAGES.fat,
};
setGoalProfile({
  age: Number(userGoal.age),
  gender: userGoal.gender === "female" ? "female" : "male",
  proteinRatio: percentages.protein,
  carbsRatio: percentages.carbs,
  fatRatio: percentages.fat,
});
```

- [ ] **Step 3: Replace `handleSaveGoal`**

Use:

```ts
const handleSaveGoal = async () => {
  const value = Number(newGoalInput);
  if (!goalProfile) {
    alert("Open Profile and complete your body stats before setting a target.");
    return;
  }
  if (!Number.isFinite(goalProfile.age)) {
    alert("Open Profile and save a valid age before setting a target.");
    return;
  }
  if (goalProfile.age < 18) {
    alert("Custom calorie targets are unavailable for users ages 13-17.");
    return;
  }

  const floor = CALORIE_FLOORS[goalProfile.gender];
  if (!Number.isFinite(value) || value < floor) {
    alert(`Enter at least ${floor} kcal/day for this profile.`);
    return;
  }

  const percentages = {
    protein: goalProfile.proteinRatio,
    carbs: goalProfile.carbsRatio,
    fat: goalProfile.fatRatio,
  };
  if (!validateMacroPercentages(percentages)) {
    alert("Open Profile and correct the macro percentages before saving.");
    return;
  }
  const grams = calculateMacroGrams(value, percentages);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase
    .from("user_goals")
    .update({
      calorie_target: value,
      goal_mode: "custom_calories",
      goal_rate: null,
      protein_grams: grams.protein,
      carbs_grams: grams.carbs,
      fat_grams: grams.fat,
    })
    .eq("user_id", user.id);

  if (error) {
    alert(`Unable to save calorie target: ${error.message}`);
    return;
  }
  setCalorieGoal(value);
  setGoals({ p: grams.protein, c: grams.carbs, f: grams.fat });
  setEditGoalModal(false);
};
```

Do not insert a partial `user_goals` row from the dashboard.

- [ ] **Step 4: Relabel and conditionally expose the editor**

Change visible copy from `Edit calorie goal` to `Custom calorie target`.
Disable or hide the edit action when `goalProfile?.age < 18`, and show:

```tsx
<Text style={styles.goalHelper}>
  Teen targets are maintenance estimates managed in Profile.
</Text>
```

Add:

```ts
goalHelper: {
  color: Colors.textMuted,
  fontSize: 11,
  lineHeight: 16,
  marginTop: 6,
},
```

- [ ] **Step 5: Verify and commit dashboard behavior**

Run:

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all commands PASS except previously documented unrelated lint
warnings; no new dashboard warning is introduced.

```bash
git add src/screens/DashboardScreen.tsx
git commit -m "feat: enforce custom calorie target safeguards"
```

### Task 10: Complete regression verification

**Files:**
- Modify only files needed to fix defects found by the checks below.

- [ ] **Step 1: Run automated quality gates**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run vercel-build
```

Expected:

- Vitest passes every nutrition-target test.
- TypeScript exits with code 0.
- Expo lint has no new warnings from touched files.
- Expo production web export completes successfully.

- [ ] **Step 2: Verify legacy rows in Supabase**

Use one test row with null metadata:

```sql
select
  user_id,
  calorie_target,
  goal_mode,
  goal_rate,
  unit_system
from public.user_goals
where goal_mode is null
limit 1;
```

Open Profile for that account. Expected:

- The existing calorie target is unchanged on load.
- No rate chip is selected.
- The screen says `Existing custom target`.
- Saving only unit or macro changes does not invent a goal rate.

- [ ] **Step 3: Verify adult metric and imperial flows**

Use a 30-year-old male, 80 kg, 180 cm, moderate activity, and `-0.50%`:

- Metric result is 2759 kcal maintenance and 2319 kcal target.
- Switching to imperial shows approximately 176.4 lb and 5 ft 11 in.
- Repeated unit switching does not change stored 80 kg / 180 cm values.
- Reloading Profile restores the selected unit and goal chip.
- A `-1.0%` custom rate shows when the 30% or 1000 kcal safeguard applies.
- A gain plan never adds more than 500 kcal/day.

- [ ] **Step 4: Verify minor behavior**

Use age 13, male, 50 kg, 160 cm:

- Sedentary target is 2364 kcal.
- Loss, gain, custom-rate, and dashboard custom-calorie controls are absent.
- Profile displays `Maintain for healthy growth`.
- Saved metadata is `goal_mode = 'minor_maintenance'` and `goal_rate is null`.

Repeat at age 17, then verify age 18 switches to the adult Mifflin path.

- [ ] **Step 5: Verify error behavior**

Confirm:

- Imperial inches `12` is rejected.
- Weight below 30 kg / 66 lb is rejected with unit-appropriate copy.
- Macro percentages other than exactly 100 cannot save.
- Supabase fetch and save failures show a user-facing message.
- Signup does not continue after a calculation or profile insert failure.

- [ ] **Step 6: Check the final diff for accidental unrelated changes**

Run:

```bash
git status --short
git diff --check
git diff --stat 39d1d1d..HEAD
```

Expected: no whitespace errors. `supabase/recipes.sql` and `.superpowers/`
remain outside the feature commits unless the user separately requests them.

- [ ] **Step 7: Commit any verification fixes**

If verification required code changes, stage only the exact touched files:

```bash
git add package.json package-lock.json README.md \
  src/lib/nutritionTargets.ts src/lib/nutritionTargets.test.ts \
  src/lib/macros.ts \
  src/components/nutrition/UnitSystemToggle.tsx \
  src/components/nutrition/TargetBreakdown.tsx \
  src/screens/AuthScreen.tsx src/styles/auth.ts \
  src/screens/ProfileScreen.tsx src/screens/DashboardScreen.tsx \
  supabase/migrations/20260614000000_add_nutrition_goal_metadata.sql
git commit -m "fix: complete nutrition target verification"
```

If no fixes were needed, do not create an empty commit.

## Source References

- Mifflin-St Jeor study:
  https://pubmed.ncbi.nlm.nih.gov/2305711/
- National Academies 2023 EER equations, Tables 5-15 and 5-16:
  https://www.nationalacademies.org/read/26818/chapter/7
- MyFitnessPal initial-goal calculation and calorie minimums:
  https://support.myfitnesspal.com/hc/en-us/articles/360032625391-How-does-MyFitnessPal-calculate-my-initial-goals
- MacroFactor algorithm overview:
  https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/
- MacroFactor cutting-rate guidance:
  https://macrofactor.com/cutting-calculator/
- MacroFactor bulking-rate guidance:
  https://macrofactor.com/bulking-calculator/
