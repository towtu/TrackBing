// Combined food search across every source the app knows about:
// the user's own My Foods (personal_foods), the generic gist DB, USDA/FDC
// data, and OpenFoodFacts. Both the Find Food screen and the Recipe builder
// use this so the two stay in lockstep.

import {completeOffNutrition,labeledServingWeight} from "./independentNutrition";
import { supabase } from "./supabase";
import { searchUSDA } from "./usda";
import { parseBarcode } from "./barcodes";
import type { FoodItem } from "./macros";

const CUSTOM_DB_URL =
  "https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json";

let gistCache: FoodItem[] | null = null;

type RecentBarcodeLogRow = {
  barcode: string | null;
  name: string | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  serving_size: string | number | null;
  serving_unit: string | null;
};

const numberOrZero = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
};

/** Generic foods from the gist DB, cached for the session. */
export async function loadGistFoods(): Promise<FoodItem[]> {
  if (gistCache) return gistCache;
  try {
    const res = await fetch(CUSTOM_DB_URL);
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.warn("Gist load returned unexpected shape");
      return [];
    }
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
    ai_estimated: !!f.ai_estimated,
  }));
}

/**
 * Recent scanned logs are stored as the exact serving the user logged.
 * `food_logs` does not keep per-100g nutrition, so these entries replay the
 * last logged serving instead of inventing conversions.
 */
export async function loadRecentBarcodeFoods(limit = 8): Promise<FoodItem[]> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("food_logs")
      .select(
        "barcode,name,calories,protein,carbs,fat,serving_size,serving_unit"
      )
      .eq("user_id", user.id)
      .not("barcode", "is", null)
      .order("created_at", { ascending: false })
      .limit(Math.max(limit * 4, limit));

    if (error) {
      console.warn("Recent barcode foods load failed", error);
      return [];
    }

    const seen = new Set<string>();
    const foods: FoodItem[] = [];

    for (const row of (data || []) as RecentBarcodeLogRow[]) {
      const barcode = row.barcode?.trim();
      if (!barcode || seen.has(barcode)) continue;
      seen.add(barcode);

      const servingSize = row.serving_size ? String(row.serving_size) : "";
      const servingUnit = row.serving_unit || "";
      const servingLabel =
        servingSize || servingUnit ? `${servingSize}${servingUnit}` : "";

      foods.push({
        code: barcode,
        product_name: row.name || "Scanned item",
        brands: servingLabel
          ? `Recent serving - ${servingLabel}`
          : "Recent serving",
        default_unit: "serving",
        serving_quantity: 1,
        serving_weight: 100,
        nutriments: {
          "energy-kcal_100g": numberOrZero(row.calories),
          proteins_100g: numberOrZero(row.protein),
          carbohydrates_100g: numberOrZero(row.carbs),
          fat_100g: numberOrZero(row.fat),
        },
      });

      if (foods.length >= limit) break;
    }

    return foods;
  } catch (e) {
    console.warn("Recent barcode foods load failed", e);
    return [];
  }
}

async function searchOpenFoodFacts(query: string): Promise<FoodItem[]> {
  try {
    const res = await fetch(
      `https://us.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
        query
      )}&search_simple=1&action=process&json=1&page_size=10&lc=en`
    );
    const offData = await res.json();
    return (
      offData.products?.filter((item: {nutriments?:unknown})=>completeOffNutrition(item.nutriments)!==null).map((item: any, index: number) => ({
        code: item.code || `off-${index}`,
        product_name: item.product_name || "Unknown Food",
        brands: item.brands || "Packaged",
        default_unit: item.product_quantity_unit === "ml" ? "ml" : "g",
        serving_weight: labeledServingWeight(item.serving_size,item.product_quantity_unit === "ml" ? "ml" : "g"),
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
 * Outcome of a barcode lookup. We distinguish "couldn't reach the database"
 * from "that code isn't in the database" so the UI can react sensibly, and
 * flag products that exist but carry no nutrition data.
 */
export type BarcodeResult =
  | { ok: true; food: FoodItem; hasNutrition: boolean }
  | { ok: false; reason: "not-found" | "unreachable" };

type PersonalBarcodeResult =
  | { ok: true; food: FoodItem | null }
  | { ok: false; reason: "auth-required" | "unreachable" };

export type BarcodeSourceLookup = {
  findPersonal: (barcode: string) => Promise<PersonalBarcodeResult>;
  findPublic: (barcode: string) => Promise<BarcodeResult>;
};

export type ResolvedBarcode =
  | {
      ok: true;
      source: "personal" | "open-food-facts";
      food: FoodItem;
      hasNutrition: boolean;
    }
  | {
      ok: false;
      reason: "invalid" | "auth-required" | "not-found" | "unreachable";
    };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Look up a single product by barcode via OpenFoodFacts. OpenFoodFacts is
 * flaky and intermittently answers with a 500 / HTML error page, so we retry a
 * few times before giving up and reporting the database as unreachable.
 */
export async function lookupBarcode(code: string): Promise<BarcodeResult> {
  const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(
    code
  )}.json`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      // 5xx is the transient flakiness we want to retry past.
      if (res.status >= 500) {
        if (attempt < 2) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        return { ok: false, reason: "unreachable" };
      }
      if (!res.ok) return { ok: false, reason: "unreachable" };

      const json = await res.json();
      if (json.status !== 1 || !json.product) {
        return { ok: false, reason: "not-found" };
      }

      const p = json.product;
      const n = p.nutriments || {};
      const complete=completeOffNutrition(n);
      const kcal=complete?.["energy-kcal_100g"]??NaN,protein=complete?.proteins_100g??NaN,carbs=complete?.carbohydrates_100g??NaN,fat=complete?.fat_100g??NaN;
      const isLiquid =
        p.product_quantity_unit === "ml" ||
        p.product_quantity_unit === "cl" ||
        p.product_quantity_unit === "l";

      return {
        ok: true,
        hasNutrition: complete!==null,
        food: {
          code,
          product_name: p.product_name || "Unknown Product",
          brands: p.brands || "Packaged Item",
          default_unit: isLiquid ? "ml" : "g",
          serving_weight: labeledServingWeight(p.serving_size,isLiquid ? "ml" : "g"),
          nutriments: {
            "energy-kcal_100g": kcal,
            proteins_100g: protein,
            carbohydrates_100g: carbs,
            fat_100g: fat,
          },
        },
      };
    } catch (e) {
      // Network error or HTML body that failed to parse as JSON — retry.
      if (attempt < 2) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      console.warn("Barcode lookup failed", e);
      return { ok: false, reason: "unreachable" };
    }
  }
  return { ok: false, reason: "unreachable" };
}

export async function resolveBarcodeWithSources(
  rawCode: string,
  sources: BarcodeSourceLookup,
): Promise<ResolvedBarcode> {
  const parsed = parseBarcode(rawCode);
  if (!parsed.ok || !parsed.barcode) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const personal = await sources.findPersonal(parsed.barcode);
    if (!personal.ok) return personal;
    if (personal.food) {
      return {
        ok: true,
        source: "personal",
        food: personal.food,
        hasNutrition: true,
      };
    }

    const publicResult = await sources.findPublic(parsed.barcode);
    if (!publicResult.ok) return publicResult;
    return {
      ok: true,
      source: "open-food-facts",
      food: publicResult.food,
      hasNutrition: publicResult.hasNutrition,
    };
  } catch {
    console.warn("Barcode source lookup failed");
    return { ok: false, reason: "unreachable" };
  }
}

type PersonalBarcodeRow = {
  id: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  default_unit: string | null;
  ai_estimated: boolean | null;
};

async function findPersonalFoodByBarcode(
  barcode: string,
): Promise<PersonalBarcodeResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "auth-required" };

  const { data, error } = await supabase
    .from("personal_foods")
    .select("id,name,calories,protein,carbs,fat,default_unit,ai_estimated")
    .eq("user_id", user.id)
    .eq("barcode", barcode)
    .maybeSingle();

  if (error) {
    console.warn("Personal barcode lookup failed");
    return { ok: false, reason: "unreachable" };
  }
  if (!data) return { ok: true, food: null };

  const row = data as PersonalBarcodeRow;
  const defaultUnit = row.default_unit || "g";
  return {
    ok: true,
    food: {
      code: barcode,
      product_name: row.name,
      brands: "My Food",
      default_unit: defaultUnit,
      serving_quantity:
        defaultUnit === "g" || defaultUnit === "ml" ? 100 : 1,
      nutriments: {
        "energy-kcal_100g": numberOrZero(row.calories),
        proteins_100g: numberOrZero(row.protein),
        carbohydrates_100g: numberOrZero(row.carbs),
        fat_100g: numberOrZero(row.fat),
      },
      original_id: row.id,
      ai_estimated: !!row.ai_estimated,
    },
  };
}

export function resolveBarcode(code: string): Promise<ResolvedBarcode> {
  return resolveBarcodeWithSources(code, {
    findPersonal: findPersonalFoodByBarcode,
    findPublic: lookupBarcode,
  });
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
