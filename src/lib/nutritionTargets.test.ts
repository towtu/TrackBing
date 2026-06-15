import { describe, expect, it } from "vitest";
import {
  ACTIVITY_MULTIPLIERS,
  CALORIE_FLOORS,
  CUSTOM_RATE_LIMITS,
  DEFAULT_MACRO_PERCENTAGES,
  GOAL_RATE_PRESETS,
  KCAL_PER_KG,
  LB_PER_KG,
  STAT_LIMITS,
  activityLevelFromStoredValue,
  calculateAdultMaintenance,
  calculateMacroGrams,
  calculateNutritionTarget,
  cmToFtIn,
  ftInToCm,
  getBodyStatsValidationError,
  isGoalMode,
  isUnitSystem,
  isValidImperialHeight,
  kgToLb,
  lbToKg,
  resolveStoredGoalMode,
  type BodyStatsInput,
  type NutritionTargetInput,
  validateMacroPercentages,
} from "./nutritionTargets";

const adultStats: BodyStatsInput = {
  age: 30,
  sex: "male",
  weightKg: 80,
  heightCm: 180,
  activityLevel: "moderate",
};

const adultBase: NutritionTargetInput = {
  ...adultStats,
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

  it("caps a deficit at 30 percent without applying the calorie floor", () => {
    expect(
      calculateNutritionTarget({
        ...adultBase,
        weeklyRate: -0.01,
      }),
    ).toMatchObject({
      maintenanceCalories: 2759,
      requestedAdjustment: -880,
      appliedAdjustment: -828,
      finalCalories: 1931,
      floorApplied: false,
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

  it("rejects unsupported adult weekly rates", () => {
    expect(() =>
      calculateNutritionTarget({ ...adultBase, weeklyRate: -0.0101 }),
    ).toThrow("Weekly rate must be between -1% and 0.5%.");
    expect(() =>
      calculateNutritionTarget({ ...adultBase, weeklyRate: 0.0051 }),
    ).toThrow("Weekly rate must be between -1% and 0.5%.");
  });

  it("rejects invalid runtime sex values", () => {
    const input = {
      ...adultBase,
      sex: "other" as NutritionTargetInput["sex"],
    };

    expect(() => calculateNutritionTarget(input)).toThrowError(RangeError);
    expect(() => calculateNutritionTarget(input)).toThrow(
      "Sex must be male or female.",
    );
  });

  it("rejects invalid runtime activity levels", () => {
    const input = {
      ...adultBase,
      activityLevel: "extreme" as NutritionTargetInput["activityLevel"],
    };

    expect(() => calculateNutritionTarget(input)).toThrowError(RangeError);
    expect(() => calculateNutritionTarget(input)).toThrow(
      "Activity level is invalid.",
    );
  });
});

describe("calculateNutritionTarget for minors", () => {
  it.each([
    ["sedentary", 2364],
    ["light", 2485],
    ["moderate", 2733],
    ["very_active", 3024],
  ] as const)(
    "uses the age-13 male %s EER equation",
    (activityLevel, expected) => {
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
    },
  );

  it.each([
    ["sedentary", 1999],
    ["light", 2223],
    ["moderate", 2347],
    ["very_active", 2659],
  ] as const)(
    "uses the age-13 female %s EER equation",
    (activityLevel, expected) => {
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
        requestedAdjustment: 0,
        appliedAdjustment: 0,
        finalCalories: expected,
        calculationMethod: "nasem_eer_2023",
      });
    },
  );

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
        weightKg: 50,
        heightCm: 160,
        activityLevel: "sedentary",
        weeklyRate: 0,
      }).calculationMethod,
    ).toBe("mifflin_st_jeor");
  });

  it("ignores supplied weekly rates and returns maintenance without safeguards", () => {
    expect(
      calculateNutritionTarget({
        age: 13,
        sex: "male",
        weightKg: 50,
        heightCm: 160,
        activityLevel: "sedentary",
        weeklyRate: -0.5,
      }),
    ).toEqual({
      maintenanceCalories: 2364,
      requestedRate: null,
      requestedAdjustment: 0,
      appliedAdjustment: 0,
      finalCalories: 2364,
      floorApplied: false,
      adjustmentCapApplied: false,
      calculationMethod: "nasem_eer_2023",
    });
  });
});

describe("nutrition target constants", () => {
  it("uses the approved activity and goal rate values", () => {
    expect(ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      very_active: 1.725,
    });
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

  it("uses the approved safety, validation, macro, and conversion values", () => {
    expect(CALORIE_FLOORS).toEqual({ male: 1500, female: 1200 });
    expect(STAT_LIMITS).toEqual({
      age: { min: 13, max: 100 },
      weightKg: { min: 30, max: 300 },
      heightCm: { min: 100, max: 250 },
      heightInchesPart: { min: 0, max: 11 },
    });
    expect(DEFAULT_MACRO_PERCENTAGES).toEqual({
      protein: 25,
      carbs: 45,
      fat: 30,
    });
    expect(KCAL_PER_KG).toBe(7700);
    expect(LB_PER_KG).toBe(2.2046226218);
  });
});

describe("stored nutrition metadata", () => {
  it("resolves activity levels from names and legacy multipliers", () => {
    expect(activityLevelFromStoredValue("moderate")).toBe("moderate");
    expect(activityLevelFromStoredValue("1.725")).toBe("very_active");
    expect(activityLevelFromStoredValue("unknown")).toBe("sedentary");
  });

  it("recognizes goal modes and unit systems", () => {
    expect(isGoalMode("estimated_rate")).toBe(true);
    expect(isGoalMode("unsupported")).toBe(false);
    expect(isUnitSystem("imperial")).toBe(true);
    expect(isUnitSystem("us_customary")).toBe(false);
  });

  it("loads missing goal metadata as a legacy custom target", () => {
    expect(resolveStoredGoalMode(null)).toBe("legacy_custom");
    expect(resolveStoredGoalMode("estimated_rate")).toBe("estimated_rate");
  });
});

describe("adult maintenance", () => {
  it("includes age in the Mifflin-St Jeor formula", () => {
    expect(calculateAdultMaintenance(adultStats)).toBeCloseTo(2759.0, 10);
    expect(
      calculateAdultMaintenance({ ...adultStats, age: adultStats.age + 1 }),
    ).toBeCloseTo(2751.25, 10);
  });

  it("rejects invalid runtime sex values", () => {
    const input = {
      ...adultStats,
      sex: "other" as BodyStatsInput["sex"],
    };

    expect(() => calculateAdultMaintenance(input)).toThrowError(RangeError);
    expect(() => calculateAdultMaintenance(input)).toThrow(
      "Sex must be male or female.",
    );
  });

  it("rejects invalid runtime activity levels", () => {
    const input = {
      ...adultStats,
      activityLevel: "extreme" as BodyStatsInput["activityLevel"],
    };

    expect(() => calculateAdultMaintenance(input)).toThrowError(RangeError);
    expect(() => calculateAdultMaintenance(input)).toThrow(
      "Activity level is invalid.",
    );
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

  it("maps whole-inch height entries to the canonical centimeter limits", () => {
    expect(ftInToCm(3, 3)).toBeLessThan(STAT_LIMITS.heightCm.min);
    expect(ftInToCm(3, 4)).toBeGreaterThanOrEqual(STAT_LIMITS.heightCm.min);
    expect(ftInToCm(8, 2)).toBeLessThanOrEqual(STAT_LIMITS.heightCm.max);
    expect(ftInToCm(8, 3)).toBeGreaterThan(STAT_LIMITS.heightCm.max);
  });
});

describe("validation and macros", () => {
  it("converts a 2000 calorie target with the default 25/45/30 split", () => {
    expect(calculateMacroGrams(2000, DEFAULT_MACRO_PERCENTAGES)).toEqual({
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

  it("returns weight validation messages in the selected display system", () => {
    const invalidWeight = { ...adultBase, weightKg: 20, weeklyRate: 0 };

    expect(getBodyStatsValidationError(invalidWeight, "metric")).toBe(
      "Weight must be between 30-300 kg.",
    );
    expect(getBodyStatsValidationError(invalidWeight, "imperial")).toBe(
      "Weight must be between 66.2-661.4 lb.",
    );
  });

  it("returns height validation messages in the selected display system", () => {
    const invalidHeight = { ...adultBase, heightCm: 99, weeklyRate: 0 };

    expect(getBodyStatsValidationError(invalidHeight, "metric")).toBe(
      "Height must be between 100-250 cm.",
    );
    expect(getBodyStatsValidationError(invalidHeight, "imperial")).toBe(
      "Height must be between 3 ft 4 in and 8 ft 2 in.",
    );
  });
});
