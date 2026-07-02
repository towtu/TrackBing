import { describe, expect, it } from "vitest";
import { buildTavilyQuery, domainOf, parseWebCandidates } from "./webNutrition";

describe("domainOf", () => {
  it("strips www and returns the hostname", () => {
    expect(domainOf("https://www.tenderjuicy.com.ph/products/cheesedog")).toBe(
      "tenderjuicy.com.ph",
    );
  });
  it("returns null for garbage", () => {
    expect(domainOf("not a url")).toBeNull();
  });
});

describe("buildTavilyQuery", () => {
  it("appends nutrition keywords", () => {
    expect(buildTavilyQuery("tender juicy cheesedog")).toBe(
      "tender juicy cheesedog nutrition facts calories protein carbs fat",
    );
  });
});

describe("parseWebCandidates", () => {
  const opts = {
    grams: 70,
    servingLabel: "70 g",
    resultUrls: ["https://www.tenderjuicy.com.ph/products/cheesedog"],
  };

  it("parses a valid candidate with web source + domain detail", () => {
    const out = parseWebCandidates(
      {
        candidates: [{
          name: "Tender Juicy Cheesedog",
          url: "https://www.tenderjuicy.com.ph/products/cheesedog",
          serving_label: "70 g", serving_grams: 70,
          kcal: 210, protein: 7, carbs: 6, fat: 17,
        }],
      },
      opts,
    );
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("web");
    expect(out[0].source_detail).toBe("tenderjuicy.com.ph");
    expect(out[0].kcal).toBe(210);
  });

  it("drops candidates whose url is not from the search results", () => {
    const out = parseWebCandidates(
      {
        candidates: [{
          name: "Made Up", url: "https://evil.example.com/x",
          kcal: 100, protein: 1, carbs: 1, fat: 1,
        }],
      },
      opts,
    );
    expect(out).toEqual([]);
  });

  it("fills serving from opts when the model omits it", () => {
    const out = parseWebCandidates(
      {
        candidates: [{
          name: "Cheesedog", url: "https://tenderjuicy.com.ph/a",
          kcal: 210, protein: 7, carbs: 6, fat: 17,
        }],
      },
      opts,
    );
    expect(out[0].serving_label).toBe("70 g");
    expect(out[0].serving_grams).toBe(70);
  });

  it("returns [] for junk payloads", () => {
    expect(parseWebCandidates(null, opts)).toEqual([]);
    expect(parseWebCandidates({ candidates: "nope" }, opts)).toEqual([]);
  });

  it("caps at 4 candidates", () => {
    const cands = Array.from({ length: 6 }, (_, i) => ({
      name: `Food ${i}`, url: "https://tenderjuicy.com.ph/a",
      kcal: 100 + i, protein: 5, carbs: 5, fat: 5,
    }));
    expect(parseWebCandidates({ candidates: cands }, opts)).toHaveLength(4);
  });
});
