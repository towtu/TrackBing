import { describe, it, expect } from "vitest";
import { currentPeriod, isProActive, decideQuota, isRateLimited } from "./quota";

describe("quota helpers", () => {
  it("formats period as YYYY-MM", () => {
    expect(currentPeriod(new Date("2026-06-29T00:00:00Z"))).toBe("2026-06");
  });

  it("pro active only when pro_until is in the future", () => {
    const now = new Date("2026-06-29T00:00:00Z");
    expect(isProActive("2026-07-01T00:00:00Z", now)).toBe(true);
    expect(isProActive("2026-06-01T00:00:00Z", now)).toBe(false);
    expect(isProActive(null, now)).toBe(false);
  });

  it("free user blocked at monthly quota", () => {
    expect(
      decideQuota({ isPro: false, monthCount: 7, dayCount: 0, freeMonthly: 7, proDaily: 100 }),
    ).toEqual({ allowed: false, reason: "over_free_quota" });
    expect(
      decideQuota({ isPro: false, monthCount: 6, dayCount: 0, freeMonthly: 7, proDaily: 100 }).allowed,
    ).toBe(true);
  });

  it("rate-limits once the per-minute count is reached", () => {
    expect(isRateLimited(14, 15)).toBe(false);
    expect(isRateLimited(15, 15)).toBe(true);
    expect(isRateLimited(20, 15)).toBe(true);
  });

  it("pro user blocked only at daily cap", () => {
    expect(
      decideQuota({ isPro: true, monthCount: 9999, dayCount: 100, freeMonthly: 7, proDaily: 100 }),
    ).toEqual({ allowed: false, reason: "over_pro_cap" });
    expect(
      decideQuota({ isPro: true, monthCount: 9999, dayCount: 99, freeMonthly: 7, proDaily: 100 }).allowed,
    ).toBe(true);
  });
});
