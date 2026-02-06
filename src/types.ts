// src/types.ts (DELETE src/types/index.ts, use only this one)

export interface FoodLog {
  id?: string;
  created_at?: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  barcode?: string;
  image_url?: string;
  serving_size?: string;
  user_id?: string;
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
  nutriments?: {
    "energy-kcal_100g"?: number;
    proteins_100g?: number;
    carbohydrates_100g?: number;
    fat_100g?: number;
    [key: string]: any; // Allows any other properties
  };
}
