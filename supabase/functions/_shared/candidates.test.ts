import { describe, expect, it } from "vitest";
import { pickCandidates } from "./candidates";
import type { AiFood } from "./macros";

const mk = (name: string, kcal: number, source: AiFood["source"]): AiFood => ({
  name, serving_label: "100 g", serving_grams: 100,
  kcal, protein: 3, carbs: 28, fat: 0.3,
  confidence: "high", source,
});

describe("pickCandidates", () => {
  it("returns null for an empty list", () => {
    expect(pickCandidates([])).toBeNull();
  });

  it("keeps order: first candidate is the food, rest are alternatives", () => {
    const r = pickCandidates([
      mk("Rice, white, cooked", 130, "usda"),
      mk("Rice, white, raw", 365, "usda"),
      mk("Jasmine rice", 129, "openfoodfacts"),
    ]);
    expect(r?.food.name).toBe("Rice, white, cooked");
    expect(r?.alternatives.map((a) => a.name)).toEqual([
      "Rice, white, raw",
      "Jasmine rice",
    ]);
  });

  it("dedupes by name case-insensitively", () => {
    const r = pickCandidates([
      mk("White Rice", 130, "usda"),
      mk("white rice", 132, "openfoodfacts"),
      mk("Brown rice", 123, "usda"),
    ]);
    expect(r?.alternatives).toHaveLength(1);
    expect(r?.alternatives[0].name).toBe("Brown rice");
  });

  it("caps alternatives at 3 by default", () => {
    const r = pickCandidates(
      ["a", "b", "c", "d", "e"].map((n, i) => mk(n, 100 + i, "usda")),
    );
    expect(r?.alternatives).toHaveLength(3);
  });
});
