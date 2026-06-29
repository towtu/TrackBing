import { describe, it, expect } from "vitest";
import { validateAndNormalize } from "./macros";

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
});
