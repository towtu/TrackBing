import { describe, expect, it } from "vitest";
import { getBeeMessage, type BeeStats } from "./beeCoach";

const baseStats: BeeStats = {
  calories: 900,
  goal: 2000,
  protein: 45,
  proteinGoal: 120,
  streak: 0,
  mealCount: 2,
};

describe("beeCoach", () => {
  it("coaches an empty day toward the first log", () => {
    const result = getBeeMessage({ ...baseStats, calories: 0, protein: 0, mealCount: 0 }, 7);

    expect(result.title.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/first meal|unang meal|start/i);
  });

  it("celebrates being under the calorie goal with remaining calories", () => {
    const result = getBeeMessage({ ...baseStats, calories: 1400, goal: 2000 }, 1);

    expect(result.message).toContain("600 kcal");
    expect(result.message).toMatch(/room|pwede|left/i);
  });

  it("handles over-goal days gently", () => {
    const result = getBeeMessage({ ...baseStats, calories: 2125, goal: 2000 }, 2);

    expect(result.message).toMatch(/lagpas|over|okay lang/i);
    expect(result.message).not.toMatch(/bad|fail|guilt|shame/i);
  });

  it("recognizes a strong protein day", () => {
    const result = getBeeMessage({ ...baseStats, protein: 112, proteinGoal: 120 }, 3);

    expect(result.message).toMatch(/protein|protina/i);
    expect(result.message).toMatch(/strong|solid|nice/i);
  });

  it("nudges low protein without shaming", () => {
    const result = getBeeMessage({ ...baseStats, protein: 18, proteinGoal: 120 }, 4);

    expect(result.message).toMatch(/protein|protina/i);
    expect(result.message).toMatch(/add|dagdag|boost/i);
  });

  it("calls out an active streak", () => {
    const result = getBeeMessage({ ...baseStats, calories: 1300, streak: 5 }, 5);

    expect(result.message).toMatch(/5-day streak|streak/i);
  });

  it("is deterministic for the same stats and seed", () => {
    const first = getBeeMessage(baseStats, 42);
    const second = getBeeMessage(baseStats, 42);

    expect(second).toEqual(first);
  });
});
