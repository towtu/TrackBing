import { describe, expect, it } from "vitest";
import { calculateCaloriesFromMacros,getUnitsToDisplay,calcMacrosRaw } from "./macros";

describe("calculateCaloriesFromMacros", () => {
  it("calculates calories from protein, carbs, and fat", () => {
    expect(calculateCaloriesFromMacros(10, 20, 5)).toBe(165);
  });

  it("treats invalid and negative macro values as zero", () => {
    expect(calculateCaloriesFromMacros(Number.NaN, -10, 2)).toBe(18);
  });
});

it("requires a mass conversion for cups and a stated serving basis",()=>{
 expect(getUnitsToDisplay({default_unit:"g"})).toEqual(["g","oz"]);
 expect(getUnitsToDisplay({default_unit:"ml"})).toContain("cup");
 expect(Number.isNaN(calcMacrosRaw({nutriments:{"energy-kcal_100g":100,proteins_100g:1,carbohydrates_100g:2,fat_100g:3}},1,"cup").c)).toBe(true);
 expect(Number.isNaN(calcMacrosRaw({},1,"serving").c)).toBe(true);
});
