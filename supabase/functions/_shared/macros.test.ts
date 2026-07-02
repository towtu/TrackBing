import { describe, it, expect } from "vitest";
import { validateAndNormalize, scaleToServing } from "./macros";

describe("validateAndNormalize", () => {
  const base = {
    name: "Egg",
    serving_label: "1 large",
    serving_grams: 50,
    kcal: 72,
    protein: 6,
    carbs: 0.4,
    fat: 5,
    confidence: "high" as const,
  };

  it("accepts a sane food unchanged", () => {
    expect(validateAndNormalize(base)).toMatchObject({ name: "Egg", kcal: 72 });
  });

  it("rejects non-objects and missing name", () => {
    expect(validateAndNormalize(null)).toBeNull();
    expect(validateAndNormalize({ ...base, name: "" })).toBeNull();
  });

  it("clamps negatives to zero", () => {
    const out = validateAndNormalize({ ...base, protein: -3 });
    expect(out?.protein).toBe(0);
  });

  it("lowers confidence when energy math is far off", () => {
    // macros imply ~26 kcal but kcal says 300 -> implausible
    const out = validateAndNormalize({ ...base, kcal: 300, protein: 1, carbs: 1, fat: 2 });
    expect(out?.confidence).toBe("low");
  });

  it("rejects absurd caps", () => {
    expect(validateAndNormalize({ ...base, kcal: 999999 })).toBeNull();
  });

  it("defaults source to ai_estimate but honors a valid source", () => {
    expect(validateAndNormalize(base)?.source).toBe("ai_estimate");
    expect(validateAndNormalize({ ...base, source: "usda" })?.source).toBe("usda");
  });
});

describe("scaleToServing", () => {
  const per100 = { kcal: 155, protein: 13, carbs: 1.1, fat: 11 }; // egg per 100g

  it("scales per-100g macros to a serving", () => {
    expect(scaleToServing(per100, 50)).toEqual({ kcal: 78, protein: 6.5, carbs: 0.6, fat: 5.5 });
  });

  it("falls back to 100g basis for non-positive grams", () => {
    expect(scaleToServing(per100, 0)).toEqual({ kcal: 155, protein: 13, carbs: 1.1, fat: 11 });
  });
});

describe("source_detail passthrough", () => {
  it("keeps a trimmed source_detail", () => {
    const food = validateAndNormalize({
      name: "Cheesedog", serving_label: "1 piece", serving_grams: 35,
      kcal: 105, protein: 4, carbs: 3, fat: 8.5,
      source: "web", source_detail: "  tenderjuicy.com.ph  ",
    });
    expect(food?.source_detail).toBe("tenderjuicy.com.ph");
  });

  it("omits source_detail when absent or not a string", () => {
    const food = validateAndNormalize({
      name: "Egg", serving_label: "1 large", serving_grams: 50,
      kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8,
      source: "usda", source_detail: 42,
    });
    expect(food?.source_detail).toBeUndefined();
  });

  it("caps source_detail at 120 chars", () => {
    const food = validateAndNormalize({
      name: "Egg", serving_label: "1 large", serving_grams: 50,
      kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8,
      source: "usda", source_detail: "x".repeat(300),
    });
    expect(food?.source_detail).toHaveLength(120);
  });
});
