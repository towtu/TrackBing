import { describe, expect, it } from "vitest";
import {
  BEE_SITUATIONS,
  beeMoodToSituation,
  getBeeAccessibilityLabel,
  getBeePose,
  getBeeTapReaction,
} from "./beeCompanion";

describe("beeCompanion", () => {
  it("maps every supported situation to the approved pose", () => {
    expect(
      Object.fromEntries(
        BEE_SITUATIONS.map((situation) => [
          situation,
          getBeePose(situation),
        ]),
      ),
    ).toEqual({
      greeting: "greeting",
      emptyDay: "encouraging",
      firstMeal: "success",
      searching: "searching",
      needsClarification: "thinking",
      reviewingMatch: "thinking",
      logSuccess: "success",
      streak: "celebrating",
      lowProtein: "encouraging",
      underTarget: "encouraging",
      nearTarget: "success",
      overTarget: "caution",
      inactiveReturn: "resting",
      lookupError: "caution",
      barcodeFound: "success",
      barcodeNotFound: "thinking",
      emptyCollection: "encouraging",
    });
  });

  it("falls back to greeting for a missing situation", () => {
    expect(getBeePose(undefined)).toBe("greeting");
    expect(getBeePose(null)).toBe("greeting");
  });

  it("converts existing coaching moods without changing coaching rules", () => {
    expect(beeMoodToSituation("inactiveMonth")).toBe("inactiveReturn");
    expect(beeMoodToSituation("inactiveWeek")).toBe("inactiveReturn");
    expect(beeMoodToSituation("empty")).toBe("emptyDay");
    expect(beeMoodToSituation("over")).toBe("overTarget");
    expect(beeMoodToSituation("strongProtein")).toBe("nearTarget");
    expect(beeMoodToSituation("lowProtein")).toBe("lowProtein");
    expect(beeMoodToSituation("streak")).toBe("streak");
    expect(beeMoodToSituation("under")).toBe("underTarget");
    expect(beeMoodToSituation("steady")).toBe("nearTarget");
  });

  it("returns deterministic, supportive tap reactions", () => {
    expect(getBeeTapReaction("emptyDay", 0)).toBe(
      "One quick log is enough to get today moving.",
    );
    expect(getBeeTapReaction("emptyDay", 3)).toBe(
      "One quick log is enough to get today moving.",
    );
    expect(getBeeTapReaction("overTarget", 1)).not.toMatch(
      /bad|failed|cheat|guilt/i,
    );
  });

  it("provides a contextual accessibility label", () => {
    expect(getBeeAccessibilityLabel("searching")).toBe(
      "Bee is searching for a food match",
    );
  });

  it("provides non-empty labels for every situation", () => {
    for (const situation of BEE_SITUATIONS) {
      expect(getBeeAccessibilityLabel(situation).trim().length).toBeGreaterThan(
        0,
      );
    }
  });
});
