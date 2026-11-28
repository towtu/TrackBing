import { afterEach, expect, it, vi } from "vitest";
import { searchAllFoods } from "./foodSearch";

vi.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        ilike: async () => ({
          data: [{ id: "fixture", name: "My test rice", default_unit: "g", calories: 100, protein: 2, carbs: 20, fat: 0 }],
        }),
      }),
    }),
  },
}));
vi.mock("./usda", () => ({
  searchUSDA: async () => [{ code: "usda-fixture", product_name: "USDA test rice" }],
}));

afterEach(() => vi.unstubAllGlobals());

it("shows My Foods, curated results and USDA for name search without calling Open Food Facts", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    requests.push(String(input));
    return new Response(JSON.stringify([{ name: "Curated test rice", c: 100, p: 2, cb: 20, f: 0 }]), { status: 200 });
  }));

  const foods = await searchAllFoods("rice");
  expect(requests).toEqual([expect.stringMatching(/^https:\/\/gist\.githubusercontent\.com\//)]);
  expect(foods.map(food => food.product_name)).toEqual(["My test rice", "Curated test rice", "USDA test rice"]);
});
