import { describe, expect, it } from "vitest";
import { isCompactPhoneLayout } from "./responsiveLayout";

describe("isCompactPhoneLayout", () => {
  it("uses the compact layout for narrow phone widths", () => {
    expect(isCompactPhoneLayout(320)).toBe(true);
    expect(isCompactPhoneLayout(389)).toBe(true);
  });

  it("keeps wider phones and desktop layouts inline", () => {
    expect(isCompactPhoneLayout(390)).toBe(false);
    expect(isCompactPhoneLayout(1024)).toBe(false);
  });
});
