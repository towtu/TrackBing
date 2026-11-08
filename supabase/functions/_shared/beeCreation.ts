import { parseFoodQuery, record } from "./beeIntent.ts";
import { scaleEvidence, type NutritionResult } from "./beeNutrition.ts";
import type { CompleteNutrients, FoodQuery, PersonalFoodDraft, RecipeDraft, RecipeLibraryIngredient, RecipePlan, ReviewedFood } from "./beeTypes.ts";

const injection = /ignore\s+(?:all\s+|previous\s+|system\s+)*instructions|(?:reveal|send|exfiltrate).{0,60}(?:secret|api.?key|token)|<(?:system|tool_call|script)/i;
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f]|https?:\/\//i.test(value) || injection.test(value)) throw new Error("invalid_creation");
  return value.trim();
}
export function parseRecipePlan(value: unknown): RecipePlan {
  const r = record(value);
  if (Object.keys(r).some(k => !["name", "servings", "ingredients", "instructions"].includes(k)) ||
    !Number.isInteger(r.servings) || Number(r.servings) < 1 || Number(r.servings) > 20 ||
    !Array.isArray(r.ingredients) || r.ingredients.length < 1 || r.ingredients.length > 8 ||
    !Array.isArray(r.instructions) || r.instructions.length < 1 || r.instructions.length > 8) throw new Error("invalid_creation");
  return { name: text(r.name, 160), servings: Number(r.servings), ingredients: r.ingredients.map(parseFoodQuery), instructions: r.instructions.map(s => text(s, 300)) };
}
const round = (n: number) => Math.round(n * 1000000) / 1000000;
function nutrients(food: ReviewedFood): CompleteNutrients {
  // Revalidate the retained independent source; a URL or model-provided macros alone are insufficient.
  const checked = scaleEvidence(food.query, food.evidence, food.source);
  if (checked.kind !== "found" || ["calories", "protein", "carbs", "fat"].some(k => checked.food[k as keyof CompleteNutrients] !== food[k as keyof CompleteNutrients])) throw new Error("unsupported_creation_evidence");
  const n = food.evidence.basis.nutrients;
  if ([n.calories, n.protein, n.carbs, n.fat].some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0)) throw new Error("missing_nutrition");
  return { calories: n.calories, protein: n.protein!, carbs: n.carbs!, fat: n.fat! };
}
function canonical(food: ReviewedFood): { unit: "g" | "ml" | "serving"; amount: number; nutrients: CompleteNutrients } {
  const n = nutrients(food), b = food.evidence.basis;
  let factor: number, amount: number, unit: "g" | "ml" | "serving";
  if (b.grams && food.grams) { factor = 100 / b.grams; amount = food.grams; unit = "g"; }
  else if (b.unit === "ml" && b.milliliters && food.portion.unit === "ml") { factor = 100 / b.milliliters; amount = food.portion.amount; unit = "ml"; }
  else if (b.count && b.unit === food.portion.unit) { factor = 1 / b.count; amount = food.portion.amount; unit = "serving"; }
  else throw new Error("unsupported_creation_conversion");
  return { unit, amount, nutrients: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, round(v * factor)])) as CompleteNutrients };
}
export function makePersonalFoodDraft(food: ReviewedFood): PersonalFoodDraft {
  const c = canonical(food);
  return { kind: "personal_food", name: text(food.name, 160), defaultUnit: c.unit, nutrients: c.nutrients, food };
}
export function makeRecipeDraft(plan: RecipePlan, foods: ReviewedFood[]): RecipeDraft {
  const valid = parseRecipePlan(plan);
  if (foods.length !== valid.ingredients.length) throw new Error("missing_ingredient");
  const ingredients: RecipeLibraryIngredient[] = foods.map((food, i) => {
    if (JSON.stringify(food.query) !== JSON.stringify(valid.ingredients[i])) throw new Error("changed_ingredient");
    const c = canonical(food), n = c.nutrients;
    return { name: food.name, brands: food.query.brand ?? "", weight: c.amount, unit: c.unit, default_unit: c.unit,
      nutriments: { "energy-kcal_100g": n.calories, proteins_100g: n.protein, carbohydrates_100g: n.carbs, fat_100g: n.fat } };
  });
  const totals: CompleteNutrients = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of ingredients) {
    const factor = ing.weight / (ing.unit === "serving" ? 1 : 100);
    totals.calories += ing.nutriments["energy-kcal_100g"] * factor;
    totals.protein += ing.nutriments.proteins_100g * factor;
    totals.carbs += ing.nutriments.carbohydrates_100g * factor;
    totals.fat += ing.nutriments.fat_100g * factor;
  }
  if (Object.values(totals).some(v => !Number.isFinite(v) || v < 0 || v > 100000)) throw new Error("invalid_recipe_total");
  return { kind: "recipe", name: valid.name, servings: valid.servings, instructions: valid.instructions, foods, ingredients,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round(v)])) as CompleteNutrients };
}
/** At most two source resolutions in flight. No Google answer is used as an ingredient. */
export async function resolveRecipe(plan: RecipePlan, search: (query: FoodQuery) => Promise<NutritionResult>): Promise<{ draft: RecipeDraft } | { message: string }> {
  const valid = parseRecipePlan(plan), foods: ReviewedFood[] = [];
  for (let start = 0; start < valid.ingredients.length; start += 2) {
    const pair = valid.ingredients.slice(start, start + 2);
    const results = await Promise.all(pair.map(search));
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.kind !== "found") return { message: `For ${pair[j].name}: ${result.message} Please provide that ingredient’s preparation, amount or complete label; no recipe has been saved.` };
      foods.push(result.food);
    }
  }
  try {
    const draft=makeRecipeDraft(valid, foods);
    if(new TextEncoder().encode(JSON.stringify(draft)).byteLength>40000)return {message:"The ingredient evidence is too large for one review. Try a simpler recipe with fewer ingredients; nothing has been saved."};
    return { draft };
  }
  catch { return { message: "I need complete independently usable nutrition for every ingredient. Enter the missing label in My Foods, then ask me to make the recipe again." }; }
}

/** Parse label numbers from the actual message, never from Gemini's response. */
export function foodFromUserLabel(message: string, now: Date): ReviewedFood | null {
  if (!/\b(?:create|make|save|add|label)\b/i.test(message)) return null;
  const name = /(?:food|label)\s*(?:named\s+|for\s+)?["“]([^"”]{1,160})["”]/i.exec(message)?.[1];
  if (!name) return null;
  const bases = [...message.matchAll(/\bper\s+(?:(\d+(?:\.\d+)?)\s*(?:g|grams?)|(?:1\s+|one\s+)?serving)\b/gi)];
  if (bases.length !== 1) return null;
  const basis = bases[0];
  const values: Record<string, number> = {};
  for (const [key, label] of Object.entries({ calories: "(?:calories|kcal)", protein: "protein", carbs: "(?:carbs|carbohydrates)", fat: "fat" })) {
    const matches = [...message.matchAll(new RegExp(`\\b${label}\\s*(?:[:=]\\s*)?(-?\\d+(?:\\.\\d+)?)(?:\\s*(?:g|grams?|kcal))?(?=\\s*(?:[,;]|$|\\.(?:\\s|$)))`, "gi"))];
    if (matches.length !== 1) return null;
    values[key] = Number(matches[0][1]);
  }
  if (Object.values(values).some(v => !Number.isFinite(v) || v < 0 || v > 10000)) return null;
  const grams = basis[1] ? Number(basis[1]) : null;
  if (grams !== null && (grams <= 0 || grams > 10000)) return null;
  const portion = { amount: grams ?? 1, unit: grams === null ? "serving" as const : "g" as const };
  const query: FoodQuery = { name: text(name, 160), preparation: null, brand: null, variant: null, packageGrams: null, market: null, portion };
  const nutritionBasis = { grams, unit: portion.unit, count: grams === null ? 1 : null, milliliters: null, nutrients: values as CompleteNutrients };
  const snapshot = { identity: query.name, url: "", sourceId: "user_label", basis: nutritionBasis, packageGrams: null, data: { userText: message } };
  const evidence = { identity: query.name, url: "", sourceId: "user_label", title: "Your label values", record: "user_owned" as const, retrievedAt: now.toISOString(), basis: nutritionBasis, excerpt: JSON.stringify(snapshot) };
  const result = scaleEvidence(query, evidence, "user_label");
  return result.kind === "found" ? result.food : null;
}
