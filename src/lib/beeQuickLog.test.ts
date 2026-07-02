import { describe, expect, it } from "vitest";
import {
  buildAiFoodLogInsert,
  getBeeQuickLogClarification,
  isBeeQuickLogConfirmation,
  mergeBeeQuickLogClarification,
} from "./beeQuickLog";
import type { AiFood } from "./aiFood";

describe("beeQuickLog", () => {
  it("asks how chicken breast was cooked when the query is missing prep details", () => {
    const clarification = getBeeQuickLogClarification(
      "I ate 600g of chicken breast",
    );

    expect(clarification).toMatchObject({
      kind: "chickenBreastPrep",
      originalQuery: "I ate 600g of chicken breast",
    });
    expect(clarification?.question).toMatch(/grilled|fried|skin/i);
    expect(clarification?.options).toContain("Grilled skinless");
  });

  it("does not ask a prep question when chicken breast already has prep details", () => {
    expect(
      getBeeQuickLogClarification("I ate 600g chicken breast grilled skinless"),
    ).toBeNull();
  });

  it("asks which Tender Juicy product the user means instead of guessing cheesedog", () => {
    const clarification = getBeeQuickLogClarification("i ate 1 tnder juicy");

    expect(clarification).toMatchObject({
      kind: "tenderJuicyVariant",
      originalQuery: "i ate 1 tnder juicy",
    });
    expect(clarification?.question).toMatch(/hotdog|cheesedog/i);
    expect(clarification?.options).toContain("Tender Juicy Hotdog");
    expect(clarification?.options).toContain("Tender Juicy Cheesedog");
  });

  it("does not ask which Tender Juicy product when the variant is already present", () => {
    expect(getBeeQuickLogClarification("1 tender juicy cheesedog")).toBeNull();
    expect(getBeeQuickLogClarification("1 tender juicy hotdog")).toBeNull();
  });

  it("merges the user's clarification into the original food query", () => {
    expect(
      mergeBeeQuickLogClarification(
        {
          kind: "chickenBreastPrep",
          originalQuery: "I ate 600g of chicken breast",
          question: "How was it cooked?",
          options: ["Grilled skinless"],
        },
        "grilled skinless",
      ),
    ).toBe("I ate 600g of chicken breast, grilled skinless");
  });

  it("builds an owner-scoped food log row from an AI food result", () => {
    const food: AiFood = {
      name: "Chicken breast, grilled skinless",
      serving_label: "600 g",
      serving_grams: 600,
      kcal: 990.4,
      protein: 186.2,
      carbs: 0,
      fat: 21.8,
      confidence: "high",
      source: "usda",
    };

    expect(buildAiFoodLogInsert("user-1", food)).toEqual({
      user_id: "user-1",
      name: "Chicken breast, grilled skinless",
      calories: 990,
      protein: 186.2,
      carbs: 0,
      fat: 21.8,
      serving_size: "600",
      serving_unit: "g",
      barcode: null,
      ai_estimated: false,
    });
  });

  it("marks fallback AI estimates on log rows", () => {
    const food: AiFood = {
      name: "Homemade mixed plate",
      serving_label: "1 serving",
      serving_grams: 350,
      kcal: 700,
      protein: 30,
      carbs: 80,
      fat: 25,
      confidence: "low",
      source: "ai_estimate",
    };

    expect(buildAiFoodLogInsert("user-1", food)).toMatchObject({
      ai_estimated: true,
      serving_size: "350",
      serving_unit: "g",
    });
  });

  it("detects short confirmation replies before logging a reviewed food", () => {
    expect(isBeeQuickLogConfirmation("yes")).toBe(true);
    expect(isBeeQuickLogConfirmation("log it")).toBe(true);
    expect(isBeeQuickLogConfirmation("looks right")).toBe(true);
    expect(isBeeQuickLogConfirmation("change to cooked rice")).toBe(false);
  });
});
