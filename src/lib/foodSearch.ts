// Combined food search across every source the app knows about:
// the user's own My Foods (personal_foods), the generic gist DB, USDA, and
// OpenFoodFacts. Both the Find Food screen and the Recipe builder use this so
// the two stay in lockstep.

import { supabase } from "./supabase";
import { searchUSDA } from "./usda";
import type { FoodItem } from "./macros";

const CUSTOM_DB_URL =
  "https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json";

let gistCache: FoodItem[] | null = null;

/** Generic foods from the gist DB, cached for the session. */
export async function loadGistFoods(): Promise<FoodItem[]> {
  if (gistCache) return gistCache;
  try {
    const res = await fetch(CUSTOM_DB_URL);
    const data = await res.json();
    gistCache = data.map((f: any) => ({
      code: "gist-" + f.name,
      product_name: f.name,
      brands: "Generic",
      default_unit: f.unit || "g",
      serving_weight: f.serving_weight,
      cup_weight: f.cup_weight,
      nutriments: {
        "energy-kcal_100g": f.c,
        proteins_100g: f.p,
        carbohydrates_100g: f.cb,
        fat_100g: f.f,
      },
    }));
    return gistCache!;
  } catch (e) {
    console.warn("Gist load failed", e);
    return [];
  }
}

/** The user's saved custom foods, matched by name. */
export async function searchPersonalFoods(query: string): Promise<FoodItem[]> {
  const { data } = await supabase
    .from("personal_foods")
    .select("*")
    .ilike("name", `%${query}%`);
  return (data || []).map((f: any) => ({
    code: "personal-" + f.id,
    product_name: f.name,
    brands: "My Food",
    default_unit: f.default_unit || "g",
    nutriments: {
      "energy-kcal_100g": f.calories,
      proteins_100g: f.protein,
      carbohydrates_100g: f.carbs,
      fat_100g: f.fat,
    },
    original_id: f.id,
  }));
}

async function searchOpenFoodFacts(query: string): Promise<FoodItem[]> {
  try {
    const res = await fetch(
      `https://us.openfoodfacts.org/cgi/search.pl?search_terms=${query}&search_simple=1&action=process&json=1&page_size=10&lc=en`
    );
    const offData = await res.json();
    return (
      offData.products?.map((item: any) => ({
        code: item.code || Math.random().toString(),
        product_name: item.product_name || "Unknown Food",
        brands: item.brands || "Packaged",
        default_unit: item.product_quantity_unit === "ml" ? "ml" : "g",
        serving_quantity: item.serving_quantity || 100,
        nutriments: {
          "energy-kcal_100g": item.nutriments?.["energy-kcal_100g"] || 0,
          proteins_100g: item.nutriments?.proteins_100g || 0,
          carbohydrates_100g: item.nutriments?.carbohydrates_100g || 0,
          fat_100g: item.nutriments?.fat_100g || 0,
        },
      })) || []
    );
  } catch (e) {
    console.warn("OpenFoodFacts search failed", e);
    return [];
  }
}

/**
 * Look up a single product by barcode via OpenFoodFacts. Returns a FoodItem
 * ready to drop into the ingredient editor, or null if the code is unknown.
 */
export async function lookupBarcode(code: string): Promise<FoodItem | null> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${code}.json`
    );
    const json = await res.json();
    if (json.status !== 1 || !json.product) return null;
    const p = json.product;
    const n = p.nutriments || {};
    const isLiquid =
      p.product_quantity_unit === "ml" ||
      p.product_quantity_unit === "cl" ||
      p.product_quantity_unit === "l";
    return {
      code,
      product_name: p.product_name || "Unknown Product",
      brands: p.brands || "Packaged Item",
      default_unit: isLiquid ? "ml" : "g",
      serving_quantity: p.serving_quantity || 100,
      nutriments: {
        "energy-kcal_100g":
          n["energy-kcal_100g"] || n["energy-kcal"] || n["energy_value"] || 0,
        proteins_100g: n.proteins_100g || n.proteins || 0,
        carbohydrates_100g: n.carbohydrates_100g || n.carbohydrates || 0,
        fat_100g: n.fat_100g || n.fat || 0,
      },
    };
  } catch (e) {
    console.warn("Barcode lookup failed", e);
    return null;
  }
}

/**
 * Search every source at once. Results are ordered with the user's own foods
 * first (My Foods, then generic gist matches), followed by USDA and packaged
 * OpenFoodFacts entries.
 */
export async function searchAllFoods(query: string): Promise<FoodItem[]> {
  const gist = await loadGistFoods();
  const gistMatches = gist.filter((f) =>
    f.product_name?.toLowerCase().includes(query.toLowerCase())
  );

  const [personal, usdaResults, offResults] = await Promise.all([
    searchPersonalFoods(query),
    searchUSDA(query),
    searchOpenFoodFacts(query),
  ]);

  return [...personal, ...gistMatches, ...usdaResults, ...offResults];
}
