// src/api/foodLogs.ts
import { supabase } from "../lib/supabase";
import { FoodLog } from "../types";

// Add a new food entry to Supabase
export async function addFoodLog(food: FoodLog) {
  const { data, error } = await supabase.from("food_logs").insert([
    {
      name: food.name,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      barcode: food.barcode,
      // user_id is handled automatically by Supabase default auth.uid()
    },
  ]);

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Delete a food entry
export async function deleteFoodLog(id: string) {
  const { error } = await supabase.from("food_logs").delete().eq("id", id);
  
  if (error) {
    throw new Error(error.message);
  }
}