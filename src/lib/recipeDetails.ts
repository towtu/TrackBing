import { calcMacrosRaw, type RecipeIngredient, type Macros } from "./macros";

export function parseRecipeDetails(servingsInput: string, steps: string):
  { ok:true;servings:number;instructions:string[] } | { ok:false;message:string } {
  const servings=Number(servingsInput.trim());
  if (!/^\d{1,2}$/.test(servingsInput.trim()) || !Number.isInteger(servings) || servings<1 || servings>20) return {ok:false,message:"Use a whole number from 1 to 20 servings."};
  const instructions=steps.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (instructions.length>8 || instructions.some(s=>s.length>300 || /[\u0000-\u001f]/.test(s))) return {ok:false,message:"Use up to eight cooking steps, each on its own line and under 300 characters."};
  return {ok:true,servings,instructions};
}

/** Sum and scale source values before rounding, including fractional servings. */
export function recipePortionTotal(ingredients:RecipeIngredient[],fraction:number):Macros {
  const total=ingredients.reduce((sum,ing)=>{
    const n=calcMacrosRaw(ing,ing.weight,ing.unit);
    return {c:sum.c+n.c,p:sum.p+n.p,cb:sum.cb+n.cb,f:sum.f+n.f};
  },{c:0,p:0,cb:0,f:0});
  return {c:Math.round(total.c*fraction),p:Math.round(total.p*fraction),cb:Math.round(total.cb*fraction),f:Math.round(total.f*fraction)};
}
