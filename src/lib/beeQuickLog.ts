import type { AiFood } from "./aiFood";
import { shouldMarkAiEstimated } from "./aiFoodUi";

export type BeeQuickLogClarification = {
  kind: "chickenBreastPrep";
  originalQuery: string;
  question: string;
  options: string[];
};

export type FoodLogInsert = {
  user_id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: string;
  serving_unit: "g";
  barcode: null;
  ai_estimated: boolean;
};

const CHICKEN_BREAST_PATTERN = /\b(chicken\s+breast|breast\s+chicken)\b/i;
const CHICKEN_PREP_PATTERN =
  /\b(grilled|fried|air\s*fried|boiled|steamed|roasted|baked|skinless|with\s+skin|skin-on|skin\s+on|breaded|sauced)\b/i;

export function getBeeQuickLogClarification(
  query: string,
): BeeQuickLogClarification | null {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) return null;

  if (
    CHICKEN_BREAST_PATTERN.test(normalized) &&
    !CHICKEN_PREP_PATTERN.test(normalized)
  ) {
    return {
      kind: "chickenBreastPrep",
      originalQuery: normalized,
      question: "Was it grilled skinless, fried, boiled, or prepared another way?",
      options: [
        "Grilled skinless",
        "Fried",
        "Boiled or steamed",
        "Roasted with skin",
      ],
    };
  }

  return null;
}

export function mergeBeeQuickLogClarification(
  clarification: BeeQuickLogClarification,
  answer: string,
) {
  const normalizedAnswer = answer.trim().replace(/\s+/g, " ");
  if (!normalizedAnswer) return clarification.originalQuery;
  return `${clarification.originalQuery}, ${normalizedAnswer}`;
}

export function buildAiFoodLogInsert(
  userId: string,
  food: AiFood,
): FoodLogInsert {
  return {
    user_id: userId,
    name: food.name,
    calories: Math.round(food.kcal),
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    serving_size: formatServingGrams(food.serving_grams),
    serving_unit: "g",
    barcode: null,
    ai_estimated: shouldMarkAiEstimated(food),
  };
}

function formatServingGrams(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "1";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
