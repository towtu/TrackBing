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
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients?: USDANutrient[];
};

export type USDAFood = {
  code: string;
  product_name: string;
  brands: string;
  default_unit: "g" | "ml";
  serving_weight?: number;
  serving_quantity?: number;
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

function getNutrient(nutrients: USDANutrient[], id: number): number | null {
  return nutrients.find((nutrient) => nutrient?.nutrientId === id &&
    typeof nutrient.value === "number" && Number.isFinite(nutrient.value) &&
    nutrient.value >= 0 && nutrient.value <= 100_000)?.value ?? null;
}

function getNutrition(food: USDAFoodSearchResult): USDAFood["nutriments"] | null {
  if (!Array.isArray(food.foodNutrients)) return null;
  const nutrients = food.foodNutrients;
  const kj = getNutrient(nutrients, 1062);
  const calories = getNutrient(nutrients, 1008) ?? (kj === null ? null : kj / 4.184);
  const protein = getNutrient(nutrients, 1003);
  const carbs = getNutrient(nutrients, 1005);
  const fat = getNutrient(nutrients, 1004);
  if (calories === null || protein === null || carbs === null || fat === null) return null;
  return {
    "energy-kcal_100g": calories,
    proteins_100g: protein,
    carbohydrates_100g: carbs,
    fat_100g: fat,
  };
}

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
      .flatMap((food) => {
        const nutriments = getNutrition(food);
        if (!nutriments) return [];
        return [{
          code: "usda-" + food.fdcId,
          product_name: food.description || "USDA food",
          brands: sourceLabel(food),
          default_unit: "g" as const,
          nutriments,
        }];
      })
      .slice(0, 50);
  } catch (e) {
    console.warn("USDA search failed", e);
    return [];
  }
}

function normalizedGtin(value: unknown): string | null {
  // The scanner passes digits without symbology. Eight digits could be UPC-E or EAN-8.
  if (typeof value !== "string" || !/^\d{12,14}$/.test(value) || /^0+$/.test(value)) return null;
  const gtin = value.padStart(14, "0");
  const sum = [...gtin].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return sum % 10 === 0 ? gtin : null;
}

type USDABarcodeResult =
  | { ok: true; food: USDAFood; hasNutrition: true }
  | { ok: false; reason: "not-found" | "unreachable" };

export async function lookupUSDABarcode(
  code: string,
  client: Pick<typeof supabase, "functions"> = supabase,
): Promise<USDABarcodeResult> {
  const gtin = normalizedGtin(code);
  if (!gtin) return { ok: false, reason: "not-found" };
  try {
    const { data, error } = await client.functions.invoke<{ foods?: unknown }>("usda-search", {
      body: { query: gtin, dataType: ["Branded"], pageSize: 10 },
      timeout: 3000,
    });
    if (error || !Array.isArray(data?.foods)) return { ok: false, reason: "unreachable" };
    const matches = data.foods.filter(isSearchResult).flatMap((food): USDAFood[] => {
      if (food.dataType !== "Branded" || normalizedGtin(food.gtinUpc) !== gtin || !food.description?.trim()) return [];
      const suppliedUnit = typeof food.servingSizeUnit === "string" ? food.servingSizeUnit.trim().toLowerCase() : "";
      const unit = suppliedUnit === "grm" ? "g" : suppliedUnit === "mlt" ? "ml" : suppliedUnit;
      const amount = food.servingSize;
      const nutriments = getNutrition(food);
      if (!nutriments || (unit !== "g" && unit !== "ml") || typeof amount !== "number" ||
        !Number.isFinite(amount) || amount <= 0 || amount > 10_000) return [];
      return [{
        code,
        product_name: food.description.trim(),
        brands: sourceLabel(food),
        default_unit: unit,
        serving_weight: amount,
        serving_quantity: amount,
        nutriments,
      }];
    });
    const match = matches[0];
    if (!match || matches.some((food) => food.default_unit !== match.default_unit ||
      food.serving_weight !== match.serving_weight || JSON.stringify(food.nutriments) !== JSON.stringify(match.nutriments))) {
      return { ok: false, reason: "not-found" };
    }
    return { ok: true, food: match, hasNutrition: true };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
