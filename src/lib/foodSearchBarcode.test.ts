import { describe, expect, it, vi } from "vitest";
import {
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

describe("resolveBarcodeWithSources", () => {
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

    await expect(
      resolveBarcodeWithSources("01234567", { findPersonal, findPublic }),
    ).resolves.toEqual({
      ok: true,
      source: "personal",
      food: personalFood,
      hasNutrition: true,
    });
    expect(findPublic).not.toHaveBeenCalled();
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
