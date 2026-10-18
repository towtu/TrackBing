import {describe,it,expect} from "vitest";
import {savedRecipeRecord} from "./beeRecipeRecord.ts";
import {searchNutrition} from "./beeNutrition.ts";
import type {FoodQuery} from "./beeTypes.ts";
// Illustrative TEST DATA, not nutrition claims or real user records.
const ingredient={name:"Fixture oats",brands:"",weight:72,unit:"g",default_unit:"g",nutriments:{"energy-kcal_100g":150,proteins_100g:12,carbohydrates_100g:2,fat_100g:10}};
const recipe={id:"fixture",name:"My fixture bowl",servings:2,ingredients:[ingredient]};
describe("owned recipe reuse",()=>{
  it("an exact owned recipe is not replaced by a generic public food with the same name",async()=>{
    const q:FoodQuery={name:recipe.name,preparation:null,brand:null,variant:null,market:null,packageGrams:null,portion:{amount:1,unit:"serving"}};
    const result=await searchNutrition(q,{signal:new AbortController().signal,usdaApiKey:"",personal:async()=>[],recipes:async()=>[savedRecipeRecord(recipe)],gist:async()=>[{name:recipe.name,c:200,p:20,cb:10,f:10,unit:"g"}]});
    expect(result.kind).toBe("found");if(result.kind==="found")expect(result.food.calories).toBe(54);
  });
  it("calculates a labeled serving without inventing cooked grams",()=>expect(savedRecipeRecord(recipe)).toMatchObject({default_unit:"serving",calories:54,protein:4.32,carbs:.72,fat:3.6}));
  it("an unusable owned recipe cannot silently fall back to a same-name public ingredient",async()=>{
    const q:FoodQuery={name:recipe.name,preparation:null,brand:null,variant:null,market:null,packageGrams:null,portion:{amount:100,unit:"g"}};
    const result=await searchNutrition(q,{signal:new AbortController().signal,usdaApiKey:"",personal:async()=>[],recipes:async()=>[savedRecipeRecord({...recipe,ingredients:[{...ingredient,unit:"cup"}]})],gist:async()=>{throw new Error("Do not replace the user's recipe");}});
    expect(result.kind).toBe("clarification");
  });
  it("retains every ingredient and scales the complete recipe only once",()=>expect(savedRecipeRecord({...recipe,ingredients:[ingredient,ingredient]}).calories).toBe(108));
  it("unknown density, missing macros and an invalid yield stay unusable",()=>{
    for(const value of [{...recipe,servings:0},{...recipe,ingredients:[{...ingredient,unit:"cup"}]},{...recipe,ingredients:[{...ingredient,nutriments:{...ingredient.nutriments,fat_100g:null}}]}])expect(Number.isFinite(savedRecipeRecord(value).calories)).toBe(false);
  });
  it("Bee can review one owned recipe serving with no public API or Google lookup",async()=>{
    const q:FoodQuery={name:recipe.name,preparation:null,brand:null,variant:null,market:null,packageGrams:null,portion:{amount:1,unit:"serving"}};
    const result=await searchNutrition(q,{signal:new AbortController().signal,usdaApiKey:"",personal:async()=>[savedRecipeRecord(recipe)],fetch:async()=>{throw new Error("No public lookup expected");}});
    expect(result.kind).toBe("found");if(result.kind==="found"){expect(result.food.calories).toBe(54);expect(result.food.grams).toBeNull();expect(result.food.evidence.attribution).toMatch(/recipe/i);}
  });
});
