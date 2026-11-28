import type { FoodItem } from "./macros";

export type RecipeIngredientRegistration = {
  requestId: string;
  userId: string;
  food: FoodItem;
};

type Listener = (kind:"personal_food"|"recipe", registration?: RecipeIngredientRegistration)=>void;
const listeners=new Set<Listener>();
export function subscribeFoodLibraryChanged(listener:Listener) { listeners.add(listener); return ()=>{listeners.delete(listener);}; }
export function emitFoodLibraryChanged(kind:"personal_food"|"recipe", registration?: RecipeIngredientRegistration) {
  listeners.forEach(listener=>listener(kind, registration));
}
