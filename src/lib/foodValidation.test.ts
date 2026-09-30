import { describe, expect, it } from "vitest";
import { parseManualFood, validateLoggedPortion, validateRecipe } from "./foodValidation";
import type { RecipeIngredient } from "./macros";

// Illustrative test data, not nutrition facts.
const ingredient: RecipeIngredient = {name:"Test food",brands:"Fixture",weight:10,unit:"g",default_unit:"g",nutriments:{"energy-kcal_100g":100,proteins_100g:1,carbohydrates_100g:2,fat_100g:3}};
describe("manual food and recipe boundaries",()=>{
  it("requires explicit values including explicit zero rather than manufacturing missing macros",()=>{
    expect(parseManualFood("Water","0","0","0")).toMatchObject({ok:true,value:{protein:0,carbs:0,fat:0,calories:0}});
    expect(parseManualFood("Water","0","","0").ok).toBe(false);
  });
  it.each(["-1","NaN","Infinity","1.2.3","4g","1e999","10001"])("rejects malformed or unreasonable macro %s",v=>expect(parseManualFood("Test",v,"0","0").ok).toBe(false));
  it("rejects blank or overlong names",()=>{
    expect(parseManualFood(" ","1","2","3").ok).toBe(false);
    expect(parseManualFood("x".repeat(161),"1","2","3").ok).toBe(false);
  });
  it.each(["0","-1","Infinity","1.2.3","50001",""])("rejects invalid portion %s before writes",v=>expect(validateLoggedPortion(v,"g",{c:10,p:1,cb:1,f:1})).not.toBeNull());
  it("retains decimal precision and limits serving counts",()=>{
    expect(validateLoggedPortion("0.5","g",{c:10,p:1,cb:1,f:1})).toBeNull();
    expect(validateLoggedPortion("101","serving",{c:10,p:1,cb:1,f:1})).not.toBeNull();
    expect(validateLoggedPortion("1","g",{c:NaN,p:1,cb:1,f:1})).not.toBeNull();
  });
  it("rejects invalid or excessive recipe snapshots",()=>{
    expect(validateRecipe("Test recipe",[ingredient])).toBeNull();
    expect(validateRecipe("Test recipe",[])).not.toBeNull();
    expect(validateRecipe("Test recipe",[{...ingredient,weight:-1}])).not.toBeNull();
    expect(validateRecipe("Test recipe",Array(51).fill(ingredient))).not.toBeNull();
    expect(validateRecipe("Test recipe",[{...ingredient,nutriments:{...ingredient.nutriments,proteins_100g:Infinity}}])).not.toBeNull();
  });
});
