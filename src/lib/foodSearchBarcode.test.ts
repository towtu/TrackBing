import { describe, expect, it, vi } from "vitest";
import {
  lookupBarcode,
  resolveBarcodeWithSources,
  type BarcodeSourceLookup,
} from "./foodSearch";
import type { FoodItem } from "./macros";

vi.mock("./supabase", () => ({ supabase: {} }));

const personalFood: FoodItem = {
  code: "personal-1",
  product_name: "My Cereal",
  brands: "My Food",
  default_unit: "g",
  nutriments: {
    "energy-kcal_100g": 380,
    proteins_100g: 8,
    carbohydrates_100g: 75,
    fat_100g: 4,
  },
};

const publicFood: FoodItem = {
  ...personalFood,
  code: "01234567",
  product_name: "Public Cereal",
  brands: "Packaged",
};

it("bounds an unresponsive Open Food Facts request", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn((_url: string, init?: RequestInit): Promise<Response> => {
    if (!init?.signal) return Promise.resolve(new Response(null, { status: 404 }));
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const result = lookupBarcode("012345678905");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(result).resolves.toEqual({ ok: false, reason: "unreachable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

describe("resolveBarcodeWithSources", () => {
  it("uses a shared exact barcode after a private miss, without querying Open Food Facts", async () => {
    const findShared = vi.fn(async () => ({
      ok: true as const,
      food: { ...publicFood, default_unit: "serving", serving_quantity: 1 },
    }));
    const findPublic = vi.fn();
    await expect(resolveBarcodeWithSources("01234567", {
      findPersonal: async () => ({ ok: true, food: null }),
      findShared,
      findPublic,
    })).resolves.toMatchObject({ ok: true, source: "trackbing-catalog", food: { default_unit: "serving", serving_quantity: 1 } });
    expect(findShared).toHaveBeenCalledWith("01234567");
    expect(findPublic).not.toHaveBeenCalled();
  });

  it("returns the personal match without calling Open Food Facts", async () => {
    const findPersonal = vi.fn(async () => ({
      ok: true as const,
      food: personalFood,
    }));
    const findPublic = vi.fn(async () => ({
      ok: true as const,
      food: publicFood,
      hasNutrition: true,
    }));
    const findShared = vi.fn();

    await expect(
      resolveBarcodeWithSources("01234567", { findPersonal, findShared, findPublic }),
    ).resolves.toEqual({
      ok: true,
      source: "personal",
      food: personalFood,
      hasNutrition: true,
    });
    expect(findPublic).not.toHaveBeenCalled();
    expect(findShared).not.toHaveBeenCalled();
  });

  it("falls back to Open Food Facts after a personal miss", async () => {
    const lookups: BarcodeSourceLookup = {
      findPersonal: vi.fn(async () => ({ ok: true as const, food: null })),
      findPublic: vi.fn(async () => ({
        ok: true as const,
        food: publicFood,
        hasNutrition: true,
      })),
    };

    await expect(
      resolveBarcodeWithSources("01234567", lookups),
    ).resolves.toMatchObject({
      ok: true,
      source: "open-food-facts",
      food: publicFood,
    });
  });

  it("returns not-found only when both sources confirm a miss", async () => {
    await expect(
      resolveBarcodeWithSources("01234567", {
        findPersonal: async () => ({ ok: true, food: null }),
        findPublic: async () => ({ ok: false, reason: "not-found" }),
      }),
    ).resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it.each([
    { ok: false as const, reason: "not-found" as const },
    { ok: true as const, food: publicFood, hasNutrition: false },
  ])("tries USDA when Open Food Facts has no usable nutrition", async (off) => {
    const findFallback = vi.fn(async () => ({ ok: true as const, food: publicFood, hasNutrition: true }));
    await expect(resolveBarcodeWithSources("01234567", {
      findPersonal: async () => ({ ok: true, food: null }),
      findPublic: async () => off,
      findFallback,
    })).resolves.toMatchObject({ source: "usda", hasNutrition: true });
    expect(findFallback).toHaveBeenCalledWith("01234567");
  });

  it("keeps a complete Open Food Facts match first and preserves manual entry after a fallback failure", async () => {
    const incomplete = { ok: true as const, food: publicFood, hasNutrition: false };
    const findFallback = vi.fn(async () => ({ ok: false as const, reason: "unreachable" as const }));
    const sources: BarcodeSourceLookup = {
      findPersonal: async () => ({ ok: true, food: null }),
      findPublic: async () => ({ ...incomplete, hasNutrition: true }),
      findFallback,
    };
    await expect(resolveBarcodeWithSources("01234567", sources)).resolves.toMatchObject({ source: "open-food-facts", hasNutrition: true });
    expect(findFallback).not.toHaveBeenCalled();
    await expect(resolveBarcodeWithSources("01234567", { ...sources, findPublic: async () => incomplete })).resolves.toMatchObject({ source: "open-food-facts", hasNutrition: false });
  });

  it("does not call the public service after a personal lookup failure", async () => {
    const findPublic = vi.fn();
    await expect(
      resolveBarcodeWithSources("01234567", {
        findPersonal: async () => ({ ok: false, reason: "unreachable" }),
        findPublic,
      }),
    ).resolves.toEqual({ ok: false, reason: "unreachable" });
    expect(findPublic).not.toHaveBeenCalled();
  });

  it("turns an unexpected source exception into a retryable failure", async () => {
    await expect(
      resolveBarcodeWithSources("01234567", {
        findPersonal: async () => {
          throw new Error("network");
        },
        findPublic: vi.fn(),
      }),
    ).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("rejects invalid scanner payloads before either lookup", async () => {
    const findPersonal = vi.fn();
    const findPublic = vi.fn();
    await expect(
      resolveBarcodeWithSources("https://example.com/1234", {
        findPersonal,
        findPublic,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(findPersonal).not.toHaveBeenCalled();
    expect(findPublic).not.toHaveBeenCalled();
  });
});
