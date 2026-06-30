import { supabase } from "./supabase";

// Client wrapper for the ai-food edge function. The DeepSeek key and all macro
// validation live server-side; this only invokes the function and maps the
// result into a tidy discriminated union for the UI.

export type FoodSource = "usda" | "openfoodfacts" | "ai_estimate";

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

export type AiFoodReason = "over_free_quota" | "over_pro_cap" | "rate_limited" | "error";

export type AiFoodResult =
  | { ok: true; food: AiFood }
  | { ok: false; reason: AiFoodReason };

export async function requestAiFood(
  query: string,
  mode: "auto" | "fill" = "auto",
): Promise<AiFoodResult> {
  try {
    const { data } = await supabase.functions.invoke<{ food?: AiFood; error?: string }>(
      "ai-food",
      { body: { query, mode } },
    );
    if (data?.food) return { ok: true, food: data.food };
    const reason = data?.error;
    if (reason === "over_free_quota" || reason === "over_pro_cap" || reason === "rate_limited") {
      return { ok: false, reason };
    }
    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
