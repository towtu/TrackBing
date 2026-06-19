import { supabase } from "./supabase";

type USDANutrient = {
  nutrientId?: number;
  value?: number;
};

type USDAFoodSearchResult = {
  fdcId?: number | string;
  description?: string;
  dataType?: string;
  brandName?: string;
  brandOwner?: string;
  foodNutrients?: USDANutrient[];
};

export type USDAFood = {
  code: string;
  product_name: string;
  brands: string;
  default_unit: "g";
  nutriments: {
    "energy-kcal_100g": number;
    proteins_100g: number;
    carbohydrates_100g: number;
    fat_100g: number;
  };
};

const DATA_TYPE_LABELS: Record<string, string> = {
  Foundation: "Foundation",
  "SR Legacy": "SR Legacy",
  "Survey (FNDDS)": "FNDDS",
  Branded: "Branded",
};

const DATA_TYPE_WEIGHTS: Record<string, number> = {
  Foundation: 12,
  "SR Legacy": 10,
  "Survey (FNDDS)": 8,
  Branded: 4,
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isSearchResult = (food: unknown): food is USDAFoodSearchResult => {
  if (!food || typeof food !== "object") return false;

  const candidate = food as USDAFoodSearchResult;
  return Boolean(candidate.fdcId && typeof candidate.description === "string");
};

const getNutrient = (nutrients: USDANutrient[], id: number) => {
  const value = nutrients.find((nutrient) => nutrient.nutrientId === id)?.value;
  return Number.isFinite(value) ? Number(value) : 0;
};

const scoreResult = (query: string, food: USDAFoodSearchResult) => {
  const normalizedQuery = normalizeText(query);
  const description = normalizeText(food.description || "");
  const brandText = normalizeText(
    [food.brandName, food.brandOwner].filter(Boolean).join(" ")
  );
  const searchableText = [description, brandText].filter(Boolean).join(" ");
  const terms = normalizedQuery.split(" ").filter(Boolean);

  let score = DATA_TYPE_WEIGHTS[food.dataType || ""] || 0;

  if (description === normalizedQuery) score += 120;
  else if (description.startsWith(normalizedQuery)) score += 90;
  else if (description.includes(normalizedQuery)) score += 70;

  const matchedTerms = terms.filter((term) => searchableText.includes(term));
  score += matchedTerms.length * 12;

  if (terms.length > 0 && matchedTerms.length === terms.length) score += 25;
  if (brandText && brandText.includes(normalizedQuery)) score += 10;

  return score - Math.min(description.length / 12, 10);
};

const sourceLabel = (food: USDAFoodSearchResult) => {
  const dataType = food.dataType
    ? DATA_TYPE_LABELS[food.dataType] || food.dataType
    : "";
  const brand = food.brandName || food.brandOwner;

  if (dataType === "Branded" && brand) return `USDA - Branded - ${brand}`;
  if (dataType) return `USDA - ${dataType}`;
  return "USDA";
};

export async function searchUSDA(query: string): Promise<USDAFood[]> {
  try {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    const { data, error } = await supabase.functions.invoke<{
      foods?: unknown;
    }>("usda-search", {
      body: { query: trimmedQuery, pageSize: 50 },
    });
    if (error || !Array.isArray(data?.foods)) return [];

    return data.foods
      .filter(isSearchResult)
      .sort(
        (a, b) => scoreResult(trimmedQuery, b) - scoreResult(trimmedQuery, a)
      )
      .slice(0, 50)
      .map((food) => {
        const nutrients = food.foodNutrients || [];
        return {
          code: "usda-" + food.fdcId,
          product_name: food.description || "USDA food",
          brands: sourceLabel(food),
          default_unit: "g",
          nutriments: {
            "energy-kcal_100g":
              getNutrient(nutrients, 1008) ||
              Math.round(getNutrient(nutrients, 1062) / 4.184),
            proteins_100g: getNutrient(nutrients, 1003),
            carbohydrates_100g: getNutrient(nutrients, 1005),
            fat_100g: getNutrient(nutrients, 1004),
          },
        };
      });
  } catch (e) {
    console.warn("USDA search failed", e);
    return [];
  }
}
