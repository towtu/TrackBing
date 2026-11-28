import { describe, expect, it } from "vitest";
import { clipSpotlight, isNewTrackBingAccount } from "./gettingStarted";

describe("Getting Started tour", () => {
  const now = Date.parse("2026-11-28T00:00:00Z");

  it("automatically starts only for accounts created in the past week", () => {
    expect(isNewTrackBingAccount("2026-11-27T22:00:00Z", now)).toBe(true);
    expect(isNewTrackBingAccount("2026-11-20T22:00:00Z", now)).toBe(false);
    expect(isNewTrackBingAccount("2026-11-29T00:00:00Z", now)).toBe(false);
    expect(isNewTrackBingAccount(undefined, now)).toBe(false);
  });

  it("pads the target and clips it inside the available viewport", () => {
    expect(clipSpotlight({ x: 15, y: 92, width: 345, height: 210 }, 375, 667))
      .toEqual({ x: 11, y: 88, width: 353, height: 218 });
    expect(clipSpotlight({ x: -4, y: -8, width: 380, height: 124 }, 375, 667))
      .toEqual({ x: 0, y: 0, width: 375, height: 120 });
  });

  it("does not create a hole in the shade when the target has no visible area", () => {
    expect(clipSpotlight({ x: 15, y: 800, width: 345, height: 90 }, 375, 667)).toBeNull();
    expect(clipSpotlight({ x: 0, y: 0, width: 0, height: 0 }, 375, 667)).toBeNull();
  });
});
