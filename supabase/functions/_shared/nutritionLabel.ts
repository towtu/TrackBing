/** Untrusted transcription, never a verified nutrition record or write permission. */
export type LabelExtraction = {
  foodName: string | null;
  basis: "per_100g" | "per_serving" | null;
  servingGrams: number | null;
  servingDescription: string | null;
  energy: number | null;
  energyUnit: "kcal" | "kJ" | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  warnings: string[];
};
export const MAX_LABEL_BYTES = 2_000_000;
/** Remove EXIF/XMP, IPTC and comment segments from a re-encoded JPEG. */
export function stripLabelMetadata(value: string): string {
  validateLabelImage(value);
  const bytes = atob(value.slice(23));
  let clean = bytes.slice(0, 2), i = 2, inScan = false;
  while (i + 1 < bytes.length) {
    if (inScan && bytes.charCodeAt(i) !== 255) {
      const next = bytes.indexOf(String.fromCharCode(255), i);
      if (next < 0) throw new Error("invalid_image");
      clean += bytes.slice(i, next);
      i = next;
      continue;
    }
    if (bytes.charCodeAt(i) !== 255) throw new Error("invalid_image");
    const marker = bytes.charCodeAt(i + 1);
    if (marker === 255) {
      clean += bytes[i];
      i++;
      continue;
    }
    if (inScan && (marker === 0 || (marker >= 208 && marker <= 215))) {
      clean += bytes.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (marker === 217) {
      if (i + 2 !== bytes.length) throw new Error("invalid_image");
      clean += bytes.slice(i, i + 2);
      return "data:image/jpeg;base64," + btoa(clean);
    }
    if (marker === 216 || marker === 0) throw new Error("invalid_image");
    inScan = marker === 218;
    const length = (bytes.charCodeAt(i + 2) << 8) + bytes.charCodeAt(i + 3);
    if (length < 2 || i + 2 + length > bytes.length) {
      throw new Error("invalid_image");
    }
    if (![225, 237, 254].includes(marker)) {
      clean += bytes.slice(i, i + 2 + length);
    }
    i += 2 + length;
  }
  throw new Error("invalid_image");
}
const keys = [
  "foodName",
  "basis",
  "servingGrams",
  "servingDescription",
  "energy",
  "energyUnit",
  "protein",
  "carbs",
  "fat",
  "warnings",
];
function safeText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" || !value.trim() || value.length > max ||
    /[\u0000-\u001f"“”<>]|https?:|ignore.{0,30}instructions|(?:reveal|exfiltrate).{0,30}(?:secret|token)/i
      .test(value)
  ) throw new Error("invalid_label");
  return value.trim();
}
function number(value: unknown, max: number, positive = false): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
    value > max || (positive && value === 0)
  ) throw new Error("invalid_label");
  return value;
}
export function parseLabelExtraction(value: unknown): LabelExtraction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_label");
  }
  const r = value as Record<string, unknown>;
  if (
    Object.keys(r).length !== keys.length ||
    Object.keys(r).some((k) => !keys.includes(k)) ||
    ![null, "per_100g", "per_serving"].includes(r.basis as null) ||
    ![null, "kcal", "kJ"].includes(r.energyUnit as null) ||
    !Array.isArray(r.warnings) || r.warnings.length > 5
  ) throw new Error("invalid_label");
  return {
    foodName: safeText(r.foodName, 160),
    basis: r.basis as LabelExtraction["basis"],
    servingGrams: number(r.servingGrams, 10000, true),
    servingDescription: safeText(r.servingDescription, 120),
    energy: number(r.energy, 10000),
    energyUnit: r.energyUnit as LabelExtraction["energyUnit"],
    protein: number(r.protein, 1000),
    carbs: number(r.carbs, 1000),
    fat: number(r.fat, 1000),
    warnings: r.warnings.map((v) => safeText(v, 200) ?? "Check the label."),
  };
}
/** Only inline JPEG; validate signature, segment lengths and pixel dimensions. */
export function validateLabelImage(
  value: unknown,
): { width: number; height: number } {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MAX_LABEL_BYTES / 3) * 4 + 23 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) throw new Error("invalid_image");
  let bytes: string;
  try {
    bytes = atob(value.slice(23));
  } catch {
    throw new Error("invalid_image");
  }
  if (
    bytes.length > MAX_LABEL_BYTES || bytes.length < 20 ||
    bytes.charCodeAt(0) !== 255 || bytes.charCodeAt(1) !== 216 ||
    bytes.charCodeAt(bytes.length - 2) !== 255 ||
    bytes.charCodeAt(bytes.length - 1) !== 217
  ) throw new Error("invalid_image");
  const word = (i: number) =>
    (bytes.charCodeAt(i) << 8) + bytes.charCodeAt(i + 1);
  for (let i = 2; i + 8 < bytes.length;) {
    if (bytes.charCodeAt(i) !== 255) throw new Error("invalid_image");
    const marker = bytes.charCodeAt(i + 1), length = word(i + 2);
    if (length < 2 || i + 2 + length > bytes.length) {
      throw new Error("invalid_image");
    }
    if (marker === 192 || marker === 194) {
      const height = word(i + 5), width = word(i + 7);
      if (
        width < 1 || height < 1 || width > 2048 || height > 2048 ||
        width * height > 4_000_000
      ) throw new Error("invalid_image");
      return { width, height };
    }
    if (marker === 218 || marker === 217) break;
    i += 2 + length;
  }
  throw new Error("invalid_image");
}
/** User edits are label input. Final portion arithmetic still runs on the server. */
export function labelReviewMessage(
  input: LabelExtraction,
  amount: number,
  unit: "g" | "serving",
): string {
  const label = parseLabelExtraction(input);
  if (
    !label.foodName || !label.basis || label.energy === null ||
    !label.energyUnit ||
    [label.protein, label.carbs, label.fat].some((v) => v === null) ||
    !Number.isFinite(amount) || amount <= 0 || amount > 10000 ||
    !["g", "serving"].includes(unit)
  ) throw new Error("incomplete_label");
  const grams = label.basis === "per_100g" ? 100 : label.servingGrams;
  if (unit === "g" && !grams) throw new Error("unknown_conversion");
  if (unit === "serving" && amount > 100) throw new Error("invalid_portion");
  const kcal = Math.round(
    (label.energyUnit === "kJ" ? label.energy / 4.184 : label.energy) * 1e6,
  ) / 1e6;
  const basis = grams ? `${grams} g` : "serving";
  const portion = unit === "g"
    ? `${amount} g`
    : grams
    ? `${amount * grams} g`
    : `${amount} serving`;
  // This exact prefix selects the deterministic server label branch, not an AI intent.
  return `Review my label food "${label.foodName}" per ${basis}: calories ${kcal}, protein ${label.protein} g, carbs ${label.carbs} g, fat ${label.fat} g; portion ${portion}.`;
}
