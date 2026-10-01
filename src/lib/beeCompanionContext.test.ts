import { describe, expect, it } from "vitest";
import { buildBeeUserContext, chooseBeeUserSituation, beeMotionProfile } from "./beeCompanionContext";
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
});
