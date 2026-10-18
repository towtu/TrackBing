import { describe, expect, it } from "vitest";
import { buildBeeSuggestionsDocument, isBeeGroundedAnswer } from "./BeeGroundedAnswer.shared";

const answer = {
  text: "Check the exact package label.",
  citations: [{ title: "Product page", url: "https://example.com/product", startIndex: 0, endIndex: 29 }],
  searchSuggestionsHtml: ['<div><a href="https://www.google.com/search?q=product">Product nutrition</a></div>'],
  searchQueryCount: 1,
};

describe("Bee live search display", () => {
  it("preserves the complete provider text and suggestion markup", () => {
    expect(isBeeGroundedAnswer(answer)).toBe(true);
    const document = buildBeeSuggestionsDocument(answer.searchSuggestionsHtml[0]);
    expect(document).toContain(answer.searchSuggestionsHtml[0]);
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).not.toContain("<script");
  });

  it("rejects the entire widget when it contains executable markup", () => {
    expect(buildBeeSuggestionsDocument('<div onmouseover="alert(1)">Search</div>')).toBeNull();
    expect(buildBeeSuggestionsDocument('<iframe src="https://example.com"></iframe>')).toBeNull();
    expect(isBeeGroundedAnswer({ ...answer, searchSuggestionsHtml: ['<script>alert(1)</script>'] })).toBe(false);
  });

  it("requires the citations and search suggestions together", () => {
    expect(isBeeGroundedAnswer({ ...answer, citations: [] })).toBe(false);
    expect(isBeeGroundedAnswer({ ...answer, searchSuggestionsHtml: [] })).toBe(false);
    expect(isBeeGroundedAnswer({ ...answer, text: "" })).toBe(false);
  });

  it("checks citation ranges against the unmodified response text", () => {
    expect(isBeeGroundedAnswer({ ...answer, citations: [{ ...answer.citations[0], endIndex: 999 }] })).toBe(false);
    expect(isBeeGroundedAnswer({ ...answer, citations: [{ ...answer.citations[0], startIndex: 10, endIndex: 3 }] })).toBe(false);
    expect(isBeeGroundedAnswer({ ...answer, citations: [{ ...answer.citations[0], startIndex: 0.5 }] })).toBe(false);
  });
});
