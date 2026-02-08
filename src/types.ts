// src/types.ts

export interface FoodLog {
  id?: string;
  created_at?: string;
  user_id?: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;

  // Optional fields
  barcode?: string;
  image_url?: string;

  // ✅ UPDATED: Stores "100" separate from "g"
  serving_size?: string;
  serving_unit?: string; // NEW: "g", "ml", "oz"
}

export interface DailyTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface ProductResult {
  code: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  image_url?: string;

  // ✅ NEW: Helpers for the app logic
  default_unit?: string; // "g", "ml", "oz"
  original_id?: string; // Needed to delete personal foods

  nutriments?: {
    "energy-kcal_100g"?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    [key: string]: any;
  };
}
