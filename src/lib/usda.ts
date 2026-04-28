import { supabase } from "./supabase";

export type USDAFood = {
  code: string;
  product_name: string;
  brands: string;
  default_unit: "g";
  nutriments: {
    "energy-kcal_100g": number;
    proteins_100g: number;
    carbohydrates_100g: number;
    fat_100g: number;
  };
};

export async function searchUSDA(query: string): Promise<USDAFood[]> {
  try {
    const { data, error } = await supabase.functions.invoke("usda-search", {
      body: { query },
    });
    if (error || !data?.foods) return [];
    return data.foods.map((food: any) => {
      const nutrients = food.foodNutrients || [];
      const get = (id: number) =>
        nutrients.find((n: any) => n.nutrientId === id)?.value || 0;
      return {
        code: "usda-" + food.fdcId,
        product_name: food.description,
        brands: "USDA",
        default_unit: "g",
        nutriments: {
          "energy-kcal_100g": get(1008) || Math.round(get(1062) / 4.184),
          proteins_100g: get(1003),
          carbohydrates_100g: get(1005),
          fat_100g: get(1004),
        },
      };
    });
  } catch (e) {
    console.warn("USDA search failed", e);
    return [];
  }
}
