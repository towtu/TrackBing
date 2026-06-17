// Shared macro math + unit helpers used by the Find Food, Recipe builder,
// and Cookbook screens. Keeping a single copy avoids the per-screen drift the
// old duplicated `calculateMacros` had.

export type Unit = "g" | "ml" | "oz" | "tsp" | "tbsp" | "cup" | "serving";

export type Nutriments = {
  "energy-kcal_100g": number;
  proteins_100g: number;
  carbohydrates_100g: number;
  fat_100g: number;
};

export type FoodItem = {
  code: string;
  product_name: string;
  brands: string;
  default_unit: string;
  serving_weight?: number;
  serving_quantity?: number;
  cup_weight?: number;
  nutriments: Nutriments;
  original_id?: string; // personal_foods row id, when applicable
};

// One ingredient as stored inside a recipe. It snapshots the food's nutriments
// so a saved recipe never breaks if a USDA/OpenFoodFacts entry changes.
export type RecipeIngredient = {
  name: string;
  brands: string;
  weight: number;
  unit: Unit;
  default_unit: string;
  serving_weight?: number;
  serving_quantity?: number;
  cup_weight?: number;
  nutriments: Nutriments;
};

export type Macros = { c: number; p: number; cb: number; f: number };

type MacroSource = {
  nutriments?: Nutriments;
  serving_weight?: number;
  serving_quantity?: number;
  cup_weight?: number;
};

/** Convert an input amount in the given unit into a "per 100g" ratio. */
function unitRatio(food: MacroSource, amount: number, unit: Unit): number {
  if (unit === "serving") {
    const sw = food.serving_weight || food.serving_quantity;
    return sw ? (amount * sw) / 100 : amount;
  }
  if (unit === "cup") {
    return food.cup_weight
      ? (amount * food.cup_weight) / 100
      : (amount * 236.588) / 100;
  }
  if (unit === "tbsp") {
    return food.cup_weight
      ? (amount * (food.cup_weight / 16)) / 100
      : (amount * 14.7868) / 100;
  }
  if (unit === "tsp") {
    return food.cup_weight
      ? (amount * (food.cup_weight / 48)) / 100
      : (amount * 4.92892) / 100;
  }
  let grams = amount;
  if (unit === "oz") grams *= 28.3495;
  return grams / 100;
}

/** Unrounded macros — use when summing many ingredients to avoid drift. */
export function calcMacrosRaw(
  food: MacroSource,
  weight: number,
  unit: Unit
): Macros {
  const ratio = unitRatio(food, weight || 0, unit);
  const n = food.nutriments;
  return {
    c: (n?.["energy-kcal_100g"] || 0) * ratio,
    p: (n?.proteins_100g || 0) * ratio,
    cb: (n?.carbohydrates_100g || 0) * ratio,
    f: (n?.fat_100g || 0) * ratio,
  };
}

/** Rounded macros for a single food at the given weight/unit. */
export function calcMacros(
  food: MacroSource,
  weight: number,
  unit: Unit
): Macros {
  const m = calcMacrosRaw(food, weight, unit);
  return {
    c: Math.round(m.c),
    p: Math.round(m.p),
    cb: Math.round(m.cb),
    f: Math.round(m.f),
  };
}

/** Sum every ingredient in a recipe at its own weight/unit, rounded once. */
export function recipeTotal(ingredients: RecipeIngredient[]): Macros {
  const sum = ingredients.reduce(
    (acc, ing) => {
      const m = calcMacrosRaw(ing, ing.weight, ing.unit);
      return {
        c: acc.c + m.c,
        p: acc.p + m.p,
        cb: acc.cb + m.cb,
        f: acc.f + m.f,
      };
    },
    { c: 0, p: 0, cb: 0, f: 0 }
  );
  return {
    c: Math.round(sum.c),
    p: Math.round(sum.p),
    cb: Math.round(sum.cb),
    f: Math.round(sum.f),
  };
}

/** Units to offer for a food, based on whether it's a liquid / has a serving. */
export function getUnitsToDisplay(food?: {
  default_unit?: string;
  serving_weight?: number;
  serving_quantity?: number;
}): Unit[] {
  if (food?.default_unit === "serving") return ["serving"];
  const isLiquid = food?.default_unit === "ml";
  const hasServing = !!(food?.serving_weight || food?.serving_quantity);
  const baseUnits: Unit[] = isLiquid
    ? ["ml", "tsp", "tbsp", "cup"]
    : ["g", "oz", "tsp", "tbsp", "cup"];
  return hasServing ? [...baseUnits, "serving"] : baseUnits;
}

/** Sensible default weight for a unit (100 for weight/volume, else 1). */
export function defaultWeightForUnit(unit: string): string {
  return unit === "g" || unit === "ml" ? "100" : "1";
}
