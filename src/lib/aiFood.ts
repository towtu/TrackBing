import { supabase } from "./supabase";

// Client wrapper for the ai-food edge function. The DeepSeek key and all macro
// validation live server-side; this only invokes the function and maps the
// result into a tidy discriminated union for the UI.

export type FoodSource = "my_food" | "usda" | "openfoodfacts" | "ai_estimate";

export type AiFood = {
  name: string;
  brand?: string;
  serving_label: string;
  serving_grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  ingredients?: { name: string; kcal: number; protein: number; carbs: number; fat: number }[];
  confidence: "high" | "medium" | "low";
  source: FoodSource;
  notes?: string;
};

export type AiFoodReason =
  | "over_free_quota"
  | "over_pro_cap"
  | "rate_limited"
  | "ai_unavailable"
  | "bad_request"
  | "unauthorized"
  | "error";

export type AiFoodResult =
  | { ok: true; food: AiFood }
  | { ok: false; reason: AiFoodReason };

export async function requestAiFood(
  query: string,
  mode: "auto" | "fill" = "auto",
): Promise<AiFoodResult> {
  try {
    const { data, error } = await supabase.functions.invoke<{ food?: AiFood; error?: string }>(
      "ai-food",
      { body: { query, mode } },
    );
    if (data?.food) return { ok: true, food: data.food };
    const bodyReason = toAiFoodReason(data?.error);
    if (bodyReason) return { ok: false, reason: bodyReason };

    const errorReason = await reasonFromFunctionError(error);
    if (errorReason) return { ok: false, reason: errorReason };

    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

const AI_FOOD_REASONS: readonly AiFoodReason[] = [
  "over_free_quota",
  "over_pro_cap",
  "rate_limited",
  "ai_unavailable",
  "bad_request",
  "unauthorized",
  "error",
];

function toAiFoodReason(value: unknown): AiFoodReason | null {
  if (typeof value !== "string") return null;
  return AI_FOOD_REASONS.includes(value as AiFoodReason)
    ? (value as AiFoodReason)
    : null;
}

async function reasonFromFunctionError(error: unknown): Promise<AiFoodReason | null> {
  if (!hasJsonContext(error)) return null;

  try {
    const body = await error.context.json();
    if (hasErrorBody(body)) return toAiFoodReason(body.error);
  } catch {
    return null;
  }

  return null;
}

function hasJsonContext(
  error: unknown,
): error is { context: { json: () => Promise<unknown> } } {
  if (typeof error !== "object" || error === null || !("context" in error)) {
    return false;
  }

  const context = error.context;
  return (
    typeof context === "object" &&
    context !== null &&
    "json" in context &&
    typeof context.json === "function"
  );
}

function hasErrorBody(body: unknown): body is { error: unknown } {
  return typeof body === "object" && body !== null && "error" in body;
}
