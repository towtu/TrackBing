import { describe, expect, it } from "vitest";
import {
  calculateNutritionTarget,
  type NutritionTargetInput,
} from "./nutritionTargets";

const adultBase: NutritionTargetInput = {
  age: 30,
  sex: "male",
  weightKg: 80,
  heightCm: 180,
  activityLevel: "moderate",
  weeklyRate: -0.005,
};

describe("calculateNutritionTarget for adults", () => {
  it("uses Mifflin-St Jeor and the selected activity level", () => {
    expect(calculateNutritionTarget(adultBase)).toMatchObject({
      maintenanceCalories: 2759,
      requestedRate: -0.005,
      requestedAdjustment: -440,
      appliedAdjustment: -440,
      finalCalories: 2319,
      floorApplied: false,
      adjustmentCapApplied: false,
      calculationMethod: "mifflin_st_jeor",
    });
  });

  it("caps an aggressive deficit at 30 percent of maintenance", () => {
    expect(
      calculateNutritionTarget({
        age: 30,
        sex: "female",
        weightKg: 60,
        heightCm: 165,
        activityLevel: "sedentary",
        weeklyRate: -0.01,
      }),
    ).toMatchObject({
      maintenanceCalories: 1584,
      requestedAdjustment: -660,
      finalCalories: 1200,
      floorApplied: true,
      adjustmentCapApplied: true,
    });
  });

  it("treats 1000 kcal as a deficit ceiling, not a preset", () => {
    expect(
      calculateNutritionTarget({
        age: 30,
        sex: "male",
        weightKg: 150,
        heightCm: 190,
        activityLevel: "very_active",
        weeklyRate: -0.01,
      }),
    ).toMatchObject({
      maintenanceCalories: 4386,
      requestedAdjustment: -1650,
      appliedAdjustment: -1000,
      finalCalories: 3386,
      adjustmentCapApplied: true,
    });
  });

  it("caps a gain surplus at 500 kcal per day", () => {
    expect(
      calculateNutritionTarget({
        age: 30,
        sex: "male",
        weightKg: 150,
        heightCm: 190,
        activityLevel: "very_active",
        weeklyRate: 0.005,
      }),
    ).toMatchObject({
      requestedAdjustment: 825,
      appliedAdjustment: 500,
      finalCalories: 4886,
      adjustmentCapApplied: true,
    });
  });

  it("applies the male minimum calorie target", () => {
    expect(
      calculateNutritionTarget({
        age: 80,
        sex: "male",
        weightKg: 50,
        heightCm: 160,
        activityLevel: "sedentary",
        weeklyRate: 0,
      }),
    ).toMatchObject({
      finalCalories: 1500,
      floorApplied: true,
    });
  });
});
