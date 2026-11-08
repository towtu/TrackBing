import {describe,it,expect} from "vitest";
import {completeOffNutrition,labeledServingWeight} from "./independentNutrition";
// Numeric values are illustrative TEST DATA, not a real product's nutrition.
describe("independent manual-search nutrition",()=>{
 it("keeps label zeroes and converts an explicit kJ per-100 basis once",()=>{const result=completeOffNutrition({energy_100g:418.4,proteins_100g:0,carbohydrates_100g:12,fat_100g:4});expect(result?.["energy-kcal_100g"]).toBeCloseTo(100,10);expect(result?.proteins_100g).toBe(0);});
 it("does not treat unspecified energy or per-serving data as kcal per 100",()=>{expect(completeOffNutrition({energy_value:100,proteins_100g:1,carbohydrates_100g:2,fat_100g:3})).toBeNull();expect(completeOffNutrition({"energy-kcal":100,proteins:1,carbohydrates:2,fat:3})).toBeNull();});
 it.each([undefined,null,NaN,-1,"1"])("missing or invalid protein %s is unknown",(protein)=>{expect(completeOffNutrition({"energy-kcal_100g":100,proteins_100g:protein,carbohydrates_100g:2,fat_100g:3})).toBeNull();});
 it("one bar is not an assumed 100g serving",()=>{expect(labeledServingWeight("1 bar (38 g)")).toBe(38);expect(labeledServingWeight("1 bar")).toBeUndefined();expect(labeledServingWeight("10 bars")).toBeUndefined();});
});
