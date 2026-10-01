import { describe, expect, it } from "vitest";
import { buildBeeUserContext, chooseBeeUserSituation, beeMotionProfile, chooseBeeNutritionCue } from "./beeCompanionContext";
import { beePoseToSituation, getBeeAccessibilityLabel } from "./beeCompanion";

// Illustrative TEST DATA only; these values are not nutrition recommendations.
const day = "2026-10-01";
const goal = { calorie_target: 2000 };
const log = (calories: number) => ({ calories });

describe("user-driven Bee", () => {
  it("does not invent a diary or a diet warning when data is unavailable", () => {
    expect(chooseBeeUserSituation(null)).toBe("greeting");
    expect(buildBeeUserContext(day, goal, null, null)).toBeNull();
  });
  it("uses today's recorded food and saved target, rather than a shared default", () => {
    expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, [], null))).toBe("emptyDay");
    expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, [log(500)], null))).toBe("encouraging");
    expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, [log(1900)], null))).toBe("success");
    expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, [log(2500)], null))).toBe("resting");
    expect(chooseBeeUserSituation(buildBeeUserContext(day, null, [log(1900)], null))).toBe("encouraging");
  });
  it("recognizes a real check-in without claiming weight loss or a trend", () => {
    expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, [], { local_date: day, is_baseline: false }))).toBe("success");
    for (const weight of [{ local_date: day, is_baseline: true }, { local_date: "2026-09-30", is_baseline: false }]) {
      expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, [], weight))).toBe("emptyDay");
    }
  });
  it("does not treat invalid or capped totals as a completed target", () => {
    for (const calories of [null, NaN, Infinity, -1, "1900"]) {
      expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, [{ calories }], null))).toBe("encouraging");
    }
    expect(chooseBeeUserSituation(buildBeeUserContext(day, goal, Array.from({ length: 250 }, () => log(100)), null))).toBe("encouraging");
    expect(chooseBeeUserSituation(buildBeeUserContext(day, { calorie_target: -1 }, [log(1900)], null))).toBe("encouraging");
  });
  it("keeps a model's semantic pose distinct from unrecorded dietary/error claims", () => {
    expect(beePoseToSituation("caution")).toBe("caution");
    expect(getBeeAccessibilityLabel(beePoseToSituation("encouraging"))).not.toMatch(/protein|target|streak/);
    expect(getBeeAccessibilityLabel(beePoseToSituation("resting"))).not.toMatch(/back|inactive/);
  });
  it("keeps movement within the mascot slot and gives tasks distinct rhythms", () => {
    expect(beeMotionProfile("searching").duration).toBeLessThan(beeMotionProfile("resting").duration);
    for (const pose of ["greeting", "thinking", "encouraging", "celebrating", "caution", "resting", "searching", "success"] as const) {
      const profile = beeMotionProfile(pose);
      expect(Math.abs(profile.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(profile.y)).toBeLessThanOrEqual(5);
      expect(Math.abs(profile.tilt)).toBeLessThanOrEqual(3);
    }
  });
  it("offers protein ideas only after enough recorded context, using saved macro targets", () => {
    const targets = { ...goal, protein_grams: 130, fat_grams: 60 };
    const meal = { calories: 600, protein: 15, fat: 10 };
    const context = buildBeeUserContext(day, targets, [meal, meal], null);
    expect(chooseBeeNutritionCue(context)).toEqual({ situation: "lowProtein", title: "Protein ideas", detail: "30 of 130 g protein recorded. Ask Bee for ideas that fit you." });
    expect(chooseBeeUserSituation(context)).toBe("lowProtein");
    expect(chooseBeeNutritionCue(buildBeeUserContext(day, targets, [meal], null))).toBeNull();
    expect(chooseBeeNutritionCue(buildBeeUserContext(day, targets, [{ ...meal, calories: 100 }, { ...meal, calories: 100 }], null))).toBeNull();
  });
  it("shows a calm factual fat review, prioritizing it over protein ideas", () => {
    const context = buildBeeUserContext(day, { ...goal, protein_grams: 130, fat_grams: 60 }, [{ calories: 1200, protein: 10, fat: 74 }, { calories: 100, protein: 5, fat: 0 }], null);
    expect(chooseBeeNutritionCue(context)).toEqual({ situation: "fatReview", title: "Fat target review", detail: "74 g fat recorded; your saved target is 60 g. Ask Bee to review." });
    expect(chooseBeeUserSituation(context)).toBe("fatReview");
    expect(getBeeAccessibilityLabel("fatReview")).not.toMatch(/bad|too much|restrict/);
  });
  it("keeps missing, invalid or capped macros unknown instead of manufacturing dietary cues", () => {
    const targets = { ...goal, protein_grams: 130, fat_grams: 60 };
    for (const invalid of [null, undefined, NaN, Infinity, -1, "10"]) {
      const context = buildBeeUserContext(day, targets, [{ calories: 1000, protein: invalid, fat: invalid }, { calories: 100, protein: 10, fat: 10 }], null);
      expect(chooseBeeNutritionCue(context)).toBeNull();
    }
    expect(chooseBeeNutritionCue(buildBeeUserContext(day, goal, [{ calories: 1200, protein: 10, fat: 80 }, { calories: 100, protein: 10, fat: 10 }], null))).toBeNull();
    expect(chooseBeeNutritionCue(buildBeeUserContext(day, targets, Array.from({ length: 250 }, () => ({ calories: 10, protein: 0, fat: 1 })), null))).toBeNull();
    expect(chooseBeeNutritionCue(buildBeeUserContext(day, targets, [], null))).toBeNull();
  });
});
