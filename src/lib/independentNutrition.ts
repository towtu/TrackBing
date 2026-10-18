import type { Nutriments } from "./macros";
/** Only explicit per-100 data can enter a complete log. Zero is valid; absence is unknown. */
export function completeOffNutrition(value:unknown):Nutriments|null {
 if(!value||typeof value!=="object"||Array.isArray(value))return null;
 const n=value as Record<string,unknown>;
 const valid=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x)&&x>=0;
 const kcal=valid(n["energy-kcal_100g"])?n["energy-kcal_100g"]:valid(n.energy_100g)?n.energy_100g/4.184:null;
 if(kcal===null||!valid(n.proteins_100g)||!valid(n.carbohydrates_100g)||!valid(n.fat_100g))return null;
 return {"energy-kcal_100g":kcal,proteins_100g:n.proteins_100g,carbohydrates_100g:n.carbohydrates_100g,fat_100g:n.fat_100g};
}
export function labeledServingWeight(value:unknown,unit:"g"|"ml"="g"):number|undefined {
 if(typeof value!=="string")return undefined;
 const match=value.match(/(?:^|[\s(])(\d+(?:\.\d+)?)\s*(g|grams?|ml)\b/i);
 if(match && (match[2].toLowerCase()==="ml" ? "ml" : "g")!==unit)return undefined;
 const weight=match?Number(match[1]):NaN;
 return Number.isFinite(weight)&&weight>0&&weight<=50000?weight:undefined;
}
