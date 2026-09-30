import { afterEach, describe, expect, it, vi } from "vitest";
import { searchAllFoods } from "./foodSearch";

vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ ilike: async () => ({ data: [] }) }),
    }),
  },
}));
vi.mock("./usda", () => ({ searchUSDA: async () => [] }));

afterEach(() => vi.unstubAllGlobals());

describe("packaged-food search", () => {
  it("uses the browser-accessible world endpoint so Philippine products are not limited to the US catalog", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("gist.githubusercontent.com")) {
        return new Response("[]", { status: 200 });
      }
      if (url.startsWith("https://world.openfoodfacts.org/cgi/search.pl?")) {
        return new Response(JSON.stringify({ products: [{
          code: "fixture-001",
          product_name: "Fixture Chocolate Bar",
          brands: "Fixture Brand",
          nutriments: {
            // Illustrative test data only; not a real product label.
            "energy-kcal_100g": 205,
            proteins_100g: 10,
            carbohydrates_100g: 30,
            fat_100g: 5,
          },
        }] }), { status: 200 });
      }
      throw new Error("Unexpected source URL");
    }));

    const foods = await searchAllFoods("Fixture Chocolate Bar");
    expect(requested).toContain(
      "https://world.openfoodfacts.org/cgi/search.pl?search_terms=Fixture%20Chocolate%20Bar&search_simple=1&action=process&json=1&page_size=10&lc=en",
    );
    expect(foods).toMatchObject([{ product_name: "Fixture Chocolate Bar", brands: "Fixture Brand" }]);
  });
});
