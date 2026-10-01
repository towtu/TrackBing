import type { BeePose, BeeSituation } from "./beeCompanion";

export type BeeUserContext = {
  localDate: string;
  foodCount: number;
  calories: number | null;
  calorieTarget: number | null;
  checkedInToday: boolean;
};

/** Presentation only. Unknown/capped totals cannot imply a completed target. */
export function buildBeeUserContext(
  localDate: string,
  goal: { calorie_target?: unknown } | null,
  foods: { calories?: unknown }[] | null,
  weight: { local_date?: unknown; is_baseline?: unknown } | null,
): BeeUserContext | null {
  if (!foods) return null;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  return {
    localDate,
    foodCount: foods.length,
    calories: foods.length < 250 && foods.every((food) => valid(food.calories))
      ? foods.reduce((total, food) => total + (food.calories as number), 0) : null,
    calorieTarget: valid(goal?.calorie_target) && goal.calorie_target > 0 ? goal.calorie_target : null,
    checkedInToday: weight?.is_baseline === false && weight.local_date === localDate,
  };
}

export function chooseBeeUserSituation(context: BeeUserContext | null): BeeSituation {
  if (!context) return "greeting";
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
