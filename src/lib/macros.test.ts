import { describe, expect, it } from "vitest";
import { calculateCaloriesFromMacros } from "./macros";

describe("calculateCaloriesFromMacros", () => {
  it("calculates calories from protein, carbs, and fat", () => {
    expect(calculateCaloriesFromMacros(10, 20, 5)).toBe(165);
  });

  it("treats invalid and negative macro values as zero", () => {
    expect(calculateCaloriesFromMacros(Number.NaN, -10, 2)).toBe(18);
  });
});
