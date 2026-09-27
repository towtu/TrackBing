import { calculateCaloriesFromMacros, recipeTotal, type Macros, type RecipeIngredient } from "./macros";

const decimal = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const units = new Set(["g","ml","oz","tsp","tbsp","cup","serving"]);
const number = (text:string, max:number): number|null => {
  const clean=text.trim();
  const value=Number(clean);
  return decimal.test(clean)&&Number.isFinite(value)&&value>=0&&value<=max?value:null;
};
const nameError=(name:string)=>!name.trim()||name.trim().length>160
  ? "Enter a food or recipe name using 1 to 160 characters." : null;

export function parseManualFood(name:string, protein:string, carbs:string, fat:string) {
  const error=nameError(name);
  if(error) return {ok:false as const,message:error};
  const p=number(protein,10000), c=number(carbs,10000), f=number(fat,10000);
  if(p===null||c===null||f===null) return {ok:false as const,message:"Enter each macro as a number from 0 to 10,000. Enter 0 only when your label states zero."};
  const calories=calculateCaloriesFromMacros(p,c,f);
  if(calories>100000) return {ok:false as const,message:"The nutrition values are too large. Check the label and serving basis."};
  return {ok:true as const,value:{name:name.trim(),protein:p,carbs:c,fat:f,calories}};
}

export function validateLoggedPortion(amount:string,unit:string,macros:Macros):string|null {
  const value=number(amount,["g","ml","oz"].includes(unit)?50000:100);
  if(!units.has(unit)||value===null||value<=0) return "Enter a positive, reasonable portion using the selected unit.";
  if(!Object.values(macros).every(v=>Number.isFinite(v)&&v>=0&&v<=100000)) return "These nutrition values cannot be saved. Check the source and portion.";
  return null;
}

export function validateRecipe(name:string,ingredients:RecipeIngredient[]):string|null {
  const error=nameError(name);
  if(error) return error;
  if(!ingredients.length||ingredients.length>50) return "A recipe needs 1 to 50 ingredients.";
  for(const item of ingredients) {
    if(nameError(item.name)||!units.has(item.default_unit)) return "Check each ingredient name and serving unit.";
    const n=item.nutriments;
    if(!n||!Object.values(n).every(v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=100000)) return "An ingredient has missing or invalid nutrition. Enter its label values first.";
    const error=validateLoggedPortion(String(item.weight),item.unit,{c:n["energy-kcal_100g"],p:n.proteins_100g,cb:n.carbohydrates_100g,f:n.fat_100g});
    if(error) return error;
  }
  if(!Object.values(recipeTotal(ingredients)).every(v=>Number.isFinite(v)&&v>=0&&v<=100000)) return "Recipe totals are too large. Check the ingredient portions.";
  return null;
}
