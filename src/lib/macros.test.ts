import { describe, expect, it } from "vitest";
import { calculateCaloriesFromMacros,getUnitsToDisplay,calcMacrosRaw,defaultFoodPortion,changeFoodPortionUnit } from "./macros";

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

describe("saved label with a known serving weight", () => {
 const food = {
   default_unit: "serving",
   serving_weight: 35,
   serving_quantity: 1,
   // Illustrative test data, not a real package.
   nutriments: { "energy-kcal_100g": 125, proteins_100g: 4, carbohydrates_100g: 20, fat_100g: 3 },
 };
 it.each([35, 41])("scales the label from a %s gram serving to 209 g", (serving) => {
   const record = { ...food, serving_weight: serving };
   const macros = calcMacrosRaw(record, 209, "g");
   expect(macros.c).toBeCloseTo(125 * 209 / serving);
   expect(macros.p).toBeCloseTo(4 * 209 / serving);
   expect(macros.cb).toBeCloseTo(20 * 209 / serving);
   expect(macros.f).toBeCloseTo(3 * 209 / serving);
   expect(defaultFoodPortion(record)).toEqual({ unit: "g", amount: String(serving) });
   expect(getUnitsToDisplay(record)).toEqual(["g", "serving"]);
 });
 it("keeps one label serving unchanged and preserves mass when switching units", () => {
   expect(calcMacrosRaw(food, 1, "serving").c).toBe(125);
   expect(changeFoodPortionUnit(food, "70", "g", "serving")).toBe("2");
   expect(changeFoodPortionUnit(food, "2", "serving", "g")).toBe("70");
 });
 it("never invents conversions for legacy servings or liquids", () => {
   const legacy = { ...food, serving_weight: undefined };
   expect(defaultFoodPortion(legacy)).toEqual({ unit: "serving", amount: "1" });
   expect(calcMacrosRaw(legacy, 209, "g").c).toBeNaN();
   expect(calcMacrosRaw(food, 209, "ml").c).toBeNaN();
 });
});
