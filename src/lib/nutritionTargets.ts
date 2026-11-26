// One trusted calculator shared by manual Profile targets and server Bee reviews.
export * from "../../supabase/functions/_shared/nutritionTargets";

export function parseDecimalInput(text: string): number | null {
  const value = text.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value)) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
