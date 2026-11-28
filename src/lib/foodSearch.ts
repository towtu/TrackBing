import type { SupabaseClient } from "@supabase/supabase-js";
import {completeOffNutrition,labeledServingWeight} from "./independentNutrition";
import { supabase } from "./supabase";
import { lookupUSDABarcode, searchUSDA } from "./usda";
import { parseBarcode } from "./barcodes";
import { createFoodAccountGuard } from "./foodAccountGuard";
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
      serving_weight: f.unit === "serving" ? undefined : f.serving_weight,
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
  return (data || []).map(toPersonalFoodItem);
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
  findShared?: (barcode: string) => Promise<PersonalBarcodeResult>;
  findPublic: (barcode: string) => Promise<BarcodeResult>;
  findUSDA?: (barcode: string) => Promise<BarcodeResult>;
};

export type ResolvedBarcode =
  | {
      ok: true;
      source: "personal" | "trackbing-catalog" | "open-food-facts" | "usda";
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt++) {
      try {
        const res = await fetch(url, { signal: controller.signal });
        // 5xx is the transient flakiness we want to retry past.
        if (res.status >= 500) {
          if (attempt < 2) {
            await sleep(500 * (attempt + 1));
            continue;
          }
          return { ok: false, reason: "unreachable" };
        }
        if (res.status === 404) return { ok: false, reason: "not-found" };
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
      } catch {
        if (controller.signal.aborted) break;
        // Network error or HTML body that failed to parse as JSON — retry.
        if (attempt < 2) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        console.warn("Open Food Facts barcode lookup failed");
        return { ok: false, reason: "unreachable" };
      }
    }
  } finally {
    clearTimeout(timeout);
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

    if (sources.findShared) {
      const shared = await sources.findShared(parsed.barcode);
      if (!shared.ok) return shared;
      if (shared.food) return { ok: true, source: "trackbing-catalog", food: shared.food, hasNutrition: true };
    }

    const usda = await sources.findUSDA?.(parsed.barcode);
    if (usda?.ok && usda.hasNutrition) return { ...usda, source: "usda" };

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

type BarcodeNutritionRow = {
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  default_unit: string | null;
  serving_grams?: number | null;
};

type PersonalBarcodeRow = BarcodeNutritionRow & { id: string; ai_estimated: boolean | null };
type BarcodeReader = { client: SupabaseClient; userId: string };

async function findPersonalFoodByBarcode(account: BarcodeReader, barcode: string): Promise<PersonalBarcodeResult> {
  const { data, error } = await account.client
    .from("personal_foods")
    .select("id,name,calories,protein,carbs,fat,default_unit,serving_grams,ai_estimated")
    .eq("user_id", account.userId)
    .eq("barcode", barcode)
    .maybeSingle();

  if (error) {
    console.warn("Personal barcode lookup failed");
    return { ok: false, reason: "unreachable" };
  }
  if (!data) return { ok: true, food: null };

  return { ok: true, food: barcodeFood(data as PersonalBarcodeRow, barcode, "My Food") };
}

function barcodeFood(
  row: BarcodeNutritionRow & Partial<PersonalBarcodeRow>,
  barcode: string,
  source: string,
): FoodItem {
  const defaultUnit = row.default_unit || "g";
  return {
    code: barcode,
    product_name: row.name,
    brands: source,
    default_unit: defaultUnit,
    serving_quantity: defaultUnit === "g" || defaultUnit === "ml" ? 100 : 1,
    serving_weight: defaultUnit === "serving" ? row.serving_grams ?? undefined : undefined,
    nutriments: {
      "energy-kcal_100g": numberOrZero(row.calories),
      proteins_100g: numberOrZero(row.protein),
      carbohydrates_100g: numberOrZero(row.carbs),
      fat_100g: numberOrZero(row.fat),
    },
    original_id: row.id,
    ai_estimated: !!row.ai_estimated,
  };
}

export function toPersonalFoodItem(row: PersonalBarcodeRow): FoodItem {
  return barcodeFood(row, `personal-${row.id}`, "My Food");
}

export async function resolveBarcode(code: string): Promise<ResolvedBarcode> {
  if (!parseBarcode(code).ok) return { ok: false, reason: "invalid" };
  const guard = createFoodAccountGuard();
  try {
    const account = await guard.authorize();
    if (!account) return { ok: false, reason: "auth-required" };
    const result = await resolveBarcodeWithSources(code, {
      findPersonal: (barcode) => findPersonalFoodByBarcode(account, barcode),
      findShared: async (barcode) => {
        const { data, error } = await account.client.rpc("lookup_shared_barcode", { p_barcode: barcode }).maybeSingle();
        if (error) return { ok: false, reason: "unreachable" };
        return { ok: true, food: data ? barcodeFood(data as BarcodeNutritionRow, barcode, "TrackBing catalog") : null };
      },
      findPublic: lookupBarcode,
      findUSDA: (barcode) => lookupUSDABarcode(barcode, account.client),
    });
    return account.isActive() ? result : { ok: false, reason: "auth-required" };
  } finally {
    guard.dispose();
  }
}

/** Find Food and the recipe builder share this name search. */
export async function searchAllFoods(query: string): Promise<FoodItem[]> {
  const [personal, gist, usdaResults] = await Promise.all([
    searchPersonalFoods(query),
    loadGistFoods(),
    searchUSDA(query),
  ]);
  const gistMatches = gist.filter(food =>
    food.product_name?.toLowerCase().includes(query.toLowerCase())
  );
  return [...personal, ...gistMatches, ...usdaResults];
}
