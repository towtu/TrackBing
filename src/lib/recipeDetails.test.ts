import { describe, it, expect } from "vitest";
import { parseRecipeDetails, recipePortionTotal } from "./recipeDetails";
describe("recipe yield and instructions", () => {
  it("preserves cooking steps and an explicit serving count", () => expect(parseRecipeDetails("4", "Cut ingredients.\nCook thoroughly.")).toMatchObject({ ok:true,servings:4,instructions:["Cut ingredients.","Cook thoroughly."] }));
  it("legacy/manual recipes may have no cooking steps",()=>expect(parseRecipeDetails("1","")).toMatchObject({ok:true,instructions:[]}));
  it.each(["0","21","2.5","2abc", "NaN", "1e1"])("rejects invalid serving count %s",servings=>expect(parseRecipeDetails(servings,"").ok).toBe(false));
  it("rejects oversized or control-character cooking steps",()=>{expect(parseRecipeDetails("2",Array(9).fill("Step").join("\n")).ok).toBe(false);expect(parseRecipeDetails("2","x".repeat(301)).ok).toBe(false);expect(parseRecipeDetails("2","Bad\u0000 step").ok).toBe(false);});
  it("scales each original ingredient before rounding a logged serving",()=>{
    // Illustrative TEST DATA, not actual nutrition.
    const ingredient={name:"Fixture",brands:"",unit:"g" as const,default_unit:"g",weight:100,nutriments:{"energy-kcal_100g":150.6,proteins_100g:12.8,carbohydrates_100g:2.8,fat_100g:10.8}};
    expect(recipePortionTotal([ingredient],1/3)).toEqual({c:50,p:4,cb:1,f:4});
  });
});
