import { describe, expect, it } from "vitest";
import { localDay, dayBounds, shiftDay, validTimeZone } from "./beeDates.ts";

describe("Bee local days", () => {
  it("uses Manila midnight instead of the server UTC date", () => {
    expect(localDay(new Date("2026-09-14T16:01:00Z"), "Asia/Manila")).toBe("2026-09-15");
    expect(dayBounds("2026-09-15", "Asia/Manila")).toEqual({ start: "2026-09-14T16:00:00.000Z", end: "2026-09-15T16:00:00.000Z" });
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("uses next local midnight through both daylight-saving transitions", () => {
    expect(dayBounds("2026-03-08", "America/New_York")).toEqual({ start: "2026-03-08T05:00:00.000Z", end: "2026-03-09T04:00:00.000Z" });
    expect(dayBounds("2026-11-01", "America/New_York")).toEqual({ start: "2026-11-01T04:00:00.000Z", end: "2026-11-02T05:00:00.000Z" });
  });
  it("rejects invalid dates and timezones", () => {
    expect(validTimeZone("Asia/Fake")).toBe(false);
    expect(validTimeZone("+08:00")).toBe(false);
    expect(() => dayBounds("2026-02-30", "UTC")).toThrow();
  });
});

// Real IANA fixed-offset zones, not inferred local offsets.
it("supports digit-bearing IANA timezone names",()=>{
 expect(validTimeZone("Etc/GMT+8")).toBe(true);
 expect(validTimeZone("Etc/GMT-3")).toBe(true);
 expect(localDay(new Date("2026-09-26T02:00:00Z"),"Etc/GMT+8")).toBe("2026-09-25");
});
