import type {PersonalRecord} from "./beeNutrition.ts";
import type {ReviewedFood} from "./beeTypes.ts";

type OwnedRecipe={id:string;name:string;ingredients:unknown;servings:number;bee_provenance?:{user_edited?:boolean;creation?:{foods?:ReviewedFood[]}}|null};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
/** The existing library stores source nutrients with explicit ingredient units.
 * Canonical Bee recipes use g/ml/serving. An edited conversion outside these
 * units requires Cookbook/manual review rather than an assumed density. */
export function savedRecipeRecord(recipe:OwnedRecipe):PersonalRecord {
  const record:PersonalRecord={id:`recipe:${recipe.id}`,name:recipe.name,default_unit:"serving",calories:NaN,protein:NaN,carbs:NaN,fat:NaN,recipe_calculated:true};
  if(!Number.isInteger(recipe.servings)||recipe.servings<1||recipe.servings>20||!Array.isArray(recipe.ingredients)||recipe.ingredients.length<1||recipe.ingredients.length>50)return record;
  const total={calories:0,protein:0,carbs:0,fat:0};
  for(const input of recipe.ingredients){
    const i=object(input),n=object(i?.nutriments);
    if(!i||!n||typeof i.weight!=="number"||!Number.isFinite(i.weight)||i.weight<=0||i.weight>100000||!["g","ml","serving"].includes(String(i.unit))||i.unit!==i.default_unit)return record;
    const factor=i.weight/(i.unit==="serving"?1:100)/recipe.servings;
    const keys={calories:"energy-kcal_100g",protein:"proteins_100g",carbs:"carbohydrates_100g",fat:"fat_100g"} as const;
    for(const key of Object.keys(keys) as (keyof typeof keys)[]){const value=n[keys[key]];if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>100000)return record;total[key]+=value*factor;}
  }
  if(Object.values(total).some(v=>!Number.isFinite(v)||v>100000))return record;
  const original=recipe.bee_provenance?.creation?.foods?.slice(0,8).filter(f=>["usda","trackbing_gist","openfoodfacts","my_food","user_label"].includes(f.source)).map(f=>({source:f.source,url:f.evidence.url,sourceId:f.evidence.sourceId,retrievedAt:f.evidence.retrievedAt,license:f.evidence.license,attribution:f.evidence.attribution,userEdited:recipe.bee_provenance?.user_edited===true}));
  return {...record,...Object.fromEntries(Object.entries(total).map(([k,v])=>[k,Math.round(v*1000000)/1000000])),...(original?{recipe_sources:original}:{})};
}
