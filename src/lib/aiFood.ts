import { supabase } from "./supabase";
import { createBeeRequestId, isBeeNutritionEvidence } from "./beeChat";
import { isBeeGroundedAnswer } from "../components/ai/BeeGroundedAnswer.shared";
import type { FoodQuery, GroundedAnswer, NutritionEvidence, Portion } from "../../supabase/functions/_shared/beeTypes";

// Client wrapper for the ai-food edge function. Provider keys and all macro
// validation live server-side; this only invokes the function and maps the
// result into a tidy discriminated union for the UI.

export type FoodSource = "my_food" | "web" | "usda" | "openfoodfacts" | "ai_estimate" | "trackbing_gist";

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
  source_detail?: string;
  notes?: string;
  evidence?: NutritionEvidence;
  requested_portion?: Portion;
  requested_query?: FoodQuery;
  user_entered?: boolean;
};

export type AiFoodReason =
  | "upgrade_required" | "pro_required" | "monthly_request_limit" | "monthly_input_limit" | "monthly_output_limit" | "monthly_search_limit" | "age_required" | "age_restricted" | "paid_data_unavailable"
  | "over_free_quota"
  | "over_pro_cap"
  | "rate_limited"
  | "ai_unavailable"
  | "bad_request"
  | "unauthorized"
  | "busy"
  | "conflict"
  | "not_configured"
  | "search_unavailable"
  | "needs_input"
  | "answer_only"
  | "error";

export type AiFoodMode = "auto" | "fill" | "web";

export type AiFoodResult =
  | { ok: true; food: AiFood; alternatives: AiFood[] }
  | { ok: false; reason: "answer_only"; answer: GroundedAnswer; message: string }
  | { ok: false; reason: "needs_input"; message: string }
  | { ok: false; reason: Exclude<AiFoodReason, "answer_only" | "needs_input"> };

export async function requestAiFood(
  query: string,
  mode: AiFoodMode = "auto",
  requestId = createBeeRequestId(),
): Promise<AiFoodResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, reason: "unauthorized" };
    const { data, error } = await supabase.functions.invoke<unknown>("ai-food", {
      body: { query, mode, requestId },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = parseResponse(data) ?? await resultFromFunctionError(error);
    const current = await supabase.auth.getSession();
    return current.data.session?.user.id === session.user.id
      ? result
      : { ok: false, reason: "unauthorized" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

const AI_FOOD_REASONS: readonly AiFoodReason[] = [
  "upgrade_required", "pro_required", "monthly_request_limit", "monthly_input_limit", "monthly_output_limit", "monthly_search_limit", "age_required", "age_restricted", "paid_data_unavailable",
  "over_free_quota",
  "over_pro_cap",
  "rate_limited",
  "ai_unavailable",
  "bad_request",
  "unauthorized",
  "busy", "conflict", "not_configured", "search_unavailable",
  "error",
];

function toAiFoodReason(value: unknown): Exclude<AiFoodReason, "answer_only" | "needs_input"> | null {
  if (typeof value !== "string") return null;
  return AI_FOOD_REASONS.includes(value as AiFoodReason)
    ? (value as Exclude<AiFoodReason, "answer_only" | "needs_input">)
    : null;
}

async function resultFromFunctionError(error: unknown): Promise<AiFoodResult> {
  if (!hasJsonContext(error)) return { ok: false, reason: "error" };

  try {
    const body = await error.context.json();
    return parseResponse(body) ?? { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

function parseResponse(value: unknown): AiFoodResult | null {
  if (!record(value)) return null;
  if (value.error === "answer_only") {
    return isBeeGroundedAnswer(value.answer) && validMessage(value.message)
      ? { ok: false, reason: "answer_only", answer: value.answer, message: value.message }
      : null;
  }
  if (value.error === "needs_input") {
    return validMessage(value.message) ? { ok: false, reason: "needs_input", message: value.message } : null;
  }
  const reason = toAiFoodReason(value.error);
  if (reason) return { ok: false, reason };
  if (!isLoggableAiFood(value.food)) return null;
  if (value.alternatives !== undefined && (!Array.isArray(value.alternatives) || !value.alternatives.every(isLoggableAiFood))) return null;
  return { ok: true, food: value.food, alternatives: (value.alternatives as AiFood[] | undefined) ?? [] };
}

/** A web answer is never a reusable nutrition record, even if it contains numbers. */
export function isLoggableAiFood(value: unknown): value is AiFood {
  if (!record(value)) return false;
  return typeof value.name === "string" && value.name.trim().length > 0 &&
    typeof value.serving_label === "string" && value.serving_label.trim().length > 0 &&
    typeof value.serving_grams === "number" && Number.isFinite(value.serving_grams) && value.serving_grams > 0 &&
    [value.kcal, value.protein, value.carbs, value.fat].every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0) &&
    ["usda", "openfoodfacts", "my_food", "trackbing_gist"].includes(String(value.source)) &&
    ["high", "medium", "low"].includes(String(value.confidence)) &&
    [value.brand, value.source_detail, value.notes].every((text) => text === undefined || typeof text === "string") &&
    (value.evidence === undefined || isBeeNutritionEvidence(value.evidence)) &&
    (value.requested_portion === undefined || (record(value.requested_portion) &&
      typeof value.requested_portion.amount === "number" && Number.isFinite(value.requested_portion.amount) && value.requested_portion.amount > 0 &&
      ["g", "oz", "ml", "cup", "piece", "bar", "serving", "pack"].includes(String(value.requested_portion.unit))));
}

/** Editing identity or nutrition makes this a user entry; the reviewed amount stays fixed. */
export function buildAiFoodReview(food: AiFood, fields: Pick<AiFood, "name" | "kcal" | "protein" | "carbs" | "fat">): AiFood {
  const name = fields.name.trim() || food.name;
  const changed = name !== food.name || fields.kcal !== food.kcal || fields.protein !== food.protein || fields.carbs !== food.carbs || fields.fat !== food.fat;
  if (!changed) return food;
  return {
    ...food, ...fields, name, source: "my_food", confidence: "low", user_entered: true,
    brand: undefined, source_detail: undefined, evidence: undefined, ingredients: undefined, requested_query: undefined,
    notes: "Values entered by you. Check them against your package label before saving.",
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validMessage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2000;
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
