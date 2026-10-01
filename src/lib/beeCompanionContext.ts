import type { BeePose, BeeSituation } from "./beeCompanion";

export type BeeUserContext = {
  localDate: string;
  foodCount: number;
  calories: number | null;
  calorieTarget: number | null;
  protein: number | null;
  proteinTarget: number | null;
  fat: number | null;
  fatTarget: number | null;
  checkedInToday: boolean;
};

/** Presentation only. Unknown/capped totals cannot imply a completed target. */
export function buildBeeUserContext(
  localDate: string,
  goal: { calorie_target?: unknown; protein_grams?: unknown; fat_grams?: unknown } | null,
  foods: { calories?: unknown; protein?: unknown; fat?: unknown }[] | null,
  weight: { local_date?: unknown; is_baseline?: unknown } | null,
): BeeUserContext | null {
  if (!foods) return null;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const total = (key: "calories" | "protein" | "fat") => {
    if (foods.length >= 250 || !foods.every((food) => valid(food[key]))) return null;
    const sum = foods.reduce((sum, food) => sum + (food[key] as number), 0);
    return Number.isFinite(sum) ? sum : null;
  };
  const target = (value: unknown) => valid(value) && value > 0 ? value : null;
  return {
    localDate,
    foodCount: foods.length,
    calories: total("calories"),
    calorieTarget: target(goal?.calorie_target),
    protein: total("protein"), proteinTarget: target(goal?.protein_grams),
    fat: total("fat"), fatTarget: target(goal?.fat_grams),
    checkedInToday: weight?.is_baseline === false && weight.local_date === localDate,
  };
}

export type BeeNutritionCue = { situation: BeeSituation; title: string; detail: string };
/** Optional presentation cues, never a diagnosis or a reason to restrict food. */
export function chooseBeeNutritionCue(context: BeeUserContext | null): BeeNutritionCue | null {
  if (!context || context.foodCount === 0) return null;
  const display = (value: number) => String(Math.round(value * 10) / 10);
  if (context.fat !== null && context.fatTarget !== null && context.fat > context.fatTarget * 1.1) {
    return { situation: "fatReview", title: "Fat target review", detail: `${display(context.fat)} g fat recorded; your saved target is ${display(context.fatTarget)} g. Ask Bee to review.` };
  }
  // Avoid prompting from a first entry or early incomplete day. Entry count is not meal count.
  if (context.foodCount >= 2 && context.calories !== null && context.calorieTarget !== null &&
      context.protein !== null && context.proteinTarget !== null &&
      context.calories >= context.calorieTarget * 0.5 &&
      context.protein / context.proteinTarget < (context.calories / context.calorieTarget) * 0.6) {
    return { situation: "lowProtein", title: "Protein ideas", detail: `${display(context.protein)} of ${display(context.proteinTarget)} g protein recorded. Ask Bee for ideas that fit you.` };
  }
  return null;
}

export function chooseBeeUserSituation(context: BeeUserContext | null): BeeSituation {
  if (!context) return "greeting";
  const cue = chooseBeeNutritionCue(context);
  if (cue) return cue.situation;
  if (context.checkedInToday) return "success";
  if (context.foodCount === 0) return "emptyDay";
  if (context.calories !== null && context.calorieTarget !== null) {
    const ratio = context.calories / context.calorieTarget;
    if (ratio > 1.1) return "resting"; // No alarm, shame or food restriction cue.
    if (ratio >= 0.9) return "success";
  }
  return "encouraging";
}

/** Native-driver transforms; no layout movement, random pose cycle, or new art. */
const MOTION: Record<BeePose, { x: number; y: number; tilt: number; duration: number }> = {
  greeting: { x: 1, y: -3, tilt: 1, duration: 1800 },
  thinking: { x: 2, y: -1, tilt: -2, duration: 2200 },
  encouraging: { x: 2, y: -4, tilt: 1.5, duration: 1600 },
  celebrating: { x: 3, y: -5, tilt: 3, duration: 800 },
  caution: { x: 1, y: -1, tilt: 0.5, duration: 2400 },
  resting: { x: 0, y: -1, tilt: 0, duration: 2600 },
  searching: { x: 3, y: -3, tilt: -2, duration: 800 },
  success: { x: 1, y: -3, tilt: 2, duration: 1400 },
};
export function beeMotionProfile(pose: BeePose) { return MOTION[pose]; }
