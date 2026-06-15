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
