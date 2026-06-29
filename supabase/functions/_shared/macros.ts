// Pure validation/normalization of a raw DeepSeek food payload.
// No Deno-specific APIs, so this file is unit-testable with vitest and reused
// by the ai-food edge function.

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
  notes?: string;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const clampNonNeg = (n: number) => (n < 0 ? 0 : n);

// Reject clearly impossible single-serving values.
const MAX_KCAL = 10000;
const MAX_GRAMS = 50000;

export function validateAndNormalize(raw: unknown): AiFood | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;

  const kcal = clampNonNeg(num(r.kcal));
  const protein = clampNonNeg(num(r.protein));
  const carbs = clampNonNeg(num(r.carbs));
  const fat = clampNonNeg(num(r.fat));
  const serving_grams = clampNonNeg(num(r.serving_grams));
  if ([kcal, protein, carbs, fat, serving_grams].some((n) => Number.isNaN(n))) return null;
  if (kcal > MAX_KCAL || serving_grams > MAX_GRAMS) return null;

  // Energy cross-check: Atwater estimate vs reported kcal.
  const estimate = 4 * protein + 4 * carbs + 9 * fat;
  let confidence: AiFood["confidence"] =
    r.confidence === "high" || r.confidence === "medium" || r.confidence === "low"
      ? (r.confidence as AiFood["confidence"])
      : "medium";
  const tolerance = Math.max(30, estimate * 0.25);
  if (Math.abs(estimate - kcal) > tolerance) confidence = "low";

  return {
    name,
    brand: typeof r.brand === "string" ? r.brand.trim() || undefined : undefined,
    serving_label:
      typeof r.serving_label === "string" && r.serving_label.trim()
        ? r.serving_label.trim()
        : "1 serving",
    serving_grams: serving_grams || 100,
    kcal: Math.round(kcal),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    confidence,
    notes: typeof r.notes === "string" ? r.notes.trim() || undefined : undefined,
  };
}
