import type { FoodQuery } from "./beeTypes.ts";
import { portionCorrection } from "./beeIntent.ts";
import { nutritionQuestionSubject } from "./beeFoodRetrieval.ts";

type ProductIdentity = {
  name: string;
  barcode: string;
  recordName: RegExp;
  aliases?: readonly string[];
  manufacturerBarGrams?: number;
  canGrams?: number;
};

// Identity only. Rebisco's product pages distinguish individual bars from
// outer packs. The 555 variants were cross-checked against retailer listings
// for the exact GTIN and package size. All nutrition is read live from OFF.
const products: readonly ProductIdentity[] = [
  { name: "Fudgee Barr Chocolate", barcode: "4800092550904", recordName: /^fudgee barr?( chocolate)?$/i, manufacturerBarGrams: 40 },
  { name: "Fudgee Barr Dark Chocolate", barcode: "4800092553226", recordName: /^(?:fudgee barr? dark chocolate)?$/i, manufacturerBarGrams: 39 },
  { name: "555 Tuna Bicol Express", aliases: ["555 Bicol Express", "555 Tuna Spicy Bicol Express"], barcode: "0748485700090", recordName: /^555 tuna (?:spicy )?bicol express(?: 155\s*g)?$/i, canGrams: 155 },
  { name: "555 Tuna Adobo", barcode: "0748485700014", recordName: /^555 tuna adobo(?: 155\s*g)?$/i, canGrams: 155 },
  { name: "555 Tuna Afritada", barcode: "0748485700021", recordName: /^555 tuna afritada(?: 155\s*g)?$/i, canGrams: 155 },
];

const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\bfudgee bar\b/, "fudgee barr").replace(/\s+/g, " ");

export function packagedIdentity(query: FoodQuery): ProductIdentity | undefined {
  return products.find(product =>
    product.barcode === query.barcode && normalizeName(product.name) === normalizeName(query.name)
  );
}

export function packagedNutritionQuestion(text: string): FoodQuery | null {
  let subject = (nutritionQuestionSubject(text) ?? text.trim()).replace(/[.!?]+$/, "");
  const can = /^(?:(?:one|1|a|the whole) can of)\s+/i.exec(subject);
  const quantity = /^(\d+(?:\.\d+)?\s*(?:g|grams?|oz|ounces?))(?:\s+of)?\s+/i.exec(subject);
  if (can || quantity) subject = subject.slice((can ?? quantity)![0].length);
  else subject = subject.replace(/^(?:one|1) serving of /i, "");
  const name = normalizeName(subject);
  const product = products.find(row => [row.name, ...(row.aliases ?? [])].some(alias => normalizeName(alias) === name));
  const portion = quantity ? portionCorrection(quantity[1]) : { amount: 1, unit: can ? "pack" as const : "serving" as const };
  if (!product || !portion || (can && !product.canGrams)) return null;
  return {
    name: product.name, barcode: product.barcode, market: "Philippines",
    preparation: null, brand: null, variant: null, packageGrams: product.canGrams ?? null,
    portion,
  };
}
