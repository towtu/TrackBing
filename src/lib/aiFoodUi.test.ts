import { describe, expect, it } from "vitest";
import { getAiFoodFeedback, shouldMarkAiEstimated } from "./aiFoodUi";

describe("aiFoodUi", () => {
  it("uses friendly Bee copy for rate limits", () => {
    expect(getAiFoodFeedback("rate_limited")).toMatchObject({
      type: "warning",
      title: "Bee's catching its breath",
    });
  });

  it("uses an upgrade prompt for quota caps", () => {
    expect(getAiFoodFeedback("over_free_quota")).toMatchObject({
      type: "info",
      title: "Bee Pro is coming soon",
    });
    expect(getAiFoodFeedback("over_pro_cap")).toMatchObject({
      type: "info",
      title: "Bee Pro is coming soon",
    });
  });

  it("uses accurate copy when the AI provider is unavailable", () => {
    expect(getAiFoodFeedback("ai_unavailable")).toMatchObject({
      type: "warning",
      title: "Bee could not reach the AI",
    });
    expect(getAiFoodFeedback("ai_unavailable").message).not.toMatch(/DeepSeek|Tavily/i);
  });

  it("marks only low-confidence AI fallback estimates as ai_estimated", () => {
    expect(shouldMarkAiEstimated({ source: "ai_estimate" })).toBe(true);
    expect(shouldMarkAiEstimated({ source: "usda" })).toBe(false);
    expect(shouldMarkAiEstimated({ source: "openfoodfacts" })).toBe(false);
    expect(shouldMarkAiEstimated({ source: "my_food" })).toBe(false);
  });
});
