import { describe, expect, it } from "vitest";
import { buildUsdaSearchTerms } from "./foodSearch";

describe("buildUsdaSearchTerms", () => {
  it("defaults ambiguous white rice to cooked no-added-fat lookup terms", () => {
    expect(buildUsdaSearchTerms("white rice")).toEqual([
      "white rice cooked no added fat",
      "white rice cooked",
      "white rice",
    ]);
  });

  it("does not force cooked terms when the user says uncooked rice", () => {
    expect(buildUsdaSearchTerms("uncooked white rice")).toEqual([
      "uncooked white rice",
    ]);
  });

  it("does not treat rice products as plain cooked rice", () => {
    expect(buildUsdaSearchTerms("rice flour")).toEqual(["rice flour"]);
  });
});
