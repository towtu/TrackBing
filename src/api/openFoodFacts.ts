// src/api/openFoodFacts.ts
import { ProductResult } from "../types";

const BASE_URL = "https://world.openfoodfacts.org";

// Search for a product by name (e.g., "Oreo")
export async function searchFood(query: string): Promise<ProductResult[]> {
  try {
    const url = `${BASE_URL}/cgi/search.pl?search_terms=${encodeURIComponent(
      query
    )}&search_simple=1&action=process&json=1`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (!data.products) return [];

    return data.products.map((item: any) => ({
      code: item.code,
      product_name: item.product_name || "Unknown Product",
      nutriments: item.nutriments || {},
      serving_size: item.serving_size,
    }));
  } catch (error) {
    console.error("Error searching food:", error);
    return [];
  }
}

// Get specific details by Barcode
export async function getFoodByBarcode(barcode: string): Promise<ProductResult | null> {
  try {
    const url = `${BASE_URL}/api/v0/product/${barcode}.json`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 1 && data.product) {
      return {
        code: data.product.code,
        product_name: data.product.product_name,
        nutriments: data.product.nutriments,
        serving_size: data.product.serving_size,
      };
    }
    return null;
  } catch (error) {
    console.error("Error fetching barcode:", error);
    return null;
  }
}