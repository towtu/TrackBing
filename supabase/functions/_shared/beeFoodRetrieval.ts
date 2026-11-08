import type { FoodQuery, NutritionEvidence } from "./beeTypes.ts";

const words = (text: string) => text.toLowerCase().normalize("NFKC")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
const SIMPLE_RICE = new Set("rice white plain normal cooked steamed boiled raw uncooked dry".split(" "));
const SOURCE_RICE = new Set([...SIMPLE_RICE, ..."brown red black long medium short grain regular enriched unenriched parboiled jasmine basmati with without salt no added water".split(" ")]);

/** A visible default for an unspecified staple, never a brand or ingredient substitute. */
export function typicalRiceQuery(query: FoodQuery): FoodQuery | null {
  if (query.brand || query.barcode || query.variant || query.packageGrams !== null) return null;
  const tokens = words(`${query.name} ${query.preparation ?? ""}`);
  if (!tokens.includes("rice") || tokens.some(word => !SIMPLE_RICE.has(word))) return null;
  const raw = tokens.some(word => ["raw", "uncooked", "dry"].includes(word));
  const cooked = tokens.some(word => ["cooked", "steamed", "boiled"].includes(word));
  if (raw && cooked) return null;
  const preparation = raw ? "raw" : tokens.includes("steamed") ? "steamed" : tokens.includes("boiled") ? "boiled" : "cooked";
  return { ...query, name: "white rice", preparation };
}

/** Only plain rice records may share a water-cooked alias; fried/mixed foods cannot. */
export function isPlainRiceIdentity(text: string): boolean {
  const tokens = words(text);
  return tokens.includes("rice") && tokens.every(word => SOURCE_RICE.has(word));
}
export function riceMatchText(text: string): string {
  return words(text).map(word => ["steamed", "boiled"].includes(word) ? "cooked"
    : ["uncooked", "dry"].includes(word) ? "raw" : word).join(" ");
}

/** Exact technique and least extra identity detail win; amounts are never averaged. */
export function rankPlainRice(query: FoodQuery, entries: NutritionEvidence[]): NutritionEvidence[] {
  if (!typicalRiceQuery(query) || entries.length < 2) return entries;
  const requested = new Set(words(riceMatchText(`${query.name} ${query.preparation ?? ""}`)));
  const score = (entry: NutritionEvidence) => {
    const actual = words(entry.identity);
    const methodPenalty = query.preparation && !actual.includes(query.preparation) ? 100 : 0;
    return methodPenalty + words(riceMatchText(entry.identity)).filter(word => !requested.has(word)).length;
  };
  const sorted = [...entries].sort((a, b) => score(a) - score(b)
    || a.identity.localeCompare(b.identity) || (a.sourceId ?? "").localeCompare(b.sourceId ?? ""));
  // A representative variety is reviewable, while conflicting copies of that
  // same identity still go through the normal evidence-conflict check.
  const identity = words(sorted[0].identity).join(" ");
  return sorted.filter(entry => words(entry.identity).join(" ") === identity);
}

export const RICE_CLARIFICATION = "Which rice type and preparation should I use for this portion?";

/** Enforce explicit input details even if the planner omitted them. */
export function riceRequestConflict(query: FoodQuery | null | undefined, text: string): boolean {
  const result = query ? typicalRiceQuery(query) : null;
  if (!result) return false;
  // A planner can omit a detail while asking a question. The visible default
  // must never turn that question into a contradictory cooked-white draft.
  const stated = words(text);
  if (stated.some(word => ["brown", "red", "black", "jasmine", "basmati", "fried", "flour", "pudding", "sticky", "glutinous", "pandan", "garlic", "oil", "coconut"].includes(word))) return true;
  const statedRaw = stated.some(word => ["raw", "uncooked", "dry"].includes(word));
  const statedCooked = stated.some(word => ["cooked", "steamed", "boiled"].includes(word));
  return (statedRaw && result.preparation !== "raw") || (statedCooked && result.preparation === "raw");
}

/** Optional variety questions must not block a complete, reviewable mass request. */
export function readyTypicalRice(query: FoodQuery | null | undefined, previous: FoodQuery | undefined, text: string): FoodQuery | null {
  if (!query || riceRequestConflict(query, text)) return null;
  let result = typicalRiceQuery(query);
  if (!result) return null;
  if (!result.portion && previous && typicalRiceQuery(previous) &&
    !/\d|\b(one|two|three|four|five|half|quarter|cup|cups|gram|grams|ounce|ounces|serving|servings|piece|pieces)\b/i.test(text)) {
    result = { ...result, portion: previous.portion };
  }
  return result.portion && ["g", "oz"].includes(result.portion.unit) &&
      Number.isFinite(result.portion.amount) && result.portion.amount > 0 && result.portion.amount <= 10000
    ? result : null;
}
