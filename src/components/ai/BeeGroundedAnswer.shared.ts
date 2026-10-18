import type { GroundedAnswer } from "../../../supabase/functions/_shared/beeTypes";
import { isSafeGroundingUrl, validateSuggestionsHtml } from "../../../supabase/functions/_shared/beeGrounding";

export function isBeeGroundedAnswer(value: unknown): value is GroundedAnswer {
  if (!record(value) || typeof value.text !== "string" || !value.text.trim() || value.text.length > 20_000 ||
      !Array.isArray(value.citations) || !value.citations.length || value.citations.length > 100 ||
      !Array.isArray(value.searchSuggestionsHtml) || !value.searchSuggestionsHtml.length || value.searchSuggestionsHtml.length > 5 ||
      !Number.isInteger(value.searchQueryCount) || Number(value.searchQueryCount) < 1 || Number(value.searchQueryCount) > 100) return false;
  return value.citations.every((citation) => record(citation) && typeof citation.title === "string" &&
    isSafeGroundingUrl(citation.url) && Number.isInteger(citation.startIndex) && Number.isInteger(citation.endIndex) &&
    Number(citation.startIndex) >= 0 && Number(citation.endIndex) > Number(citation.startIndex) &&
    Number(citation.endIndex) <= String(value.text).length) && value.searchSuggestionsHtml.every(validateSuggestionsHtml);
}

export function buildBeeSuggestionsDocument(html: string): string | null {
  if (!validateSuggestionsHtml(html)) return null;
  // Preserve Google's entire widget. The shell prevents network loads and script execution.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'"></head><body style="margin:0">${html}</body></html>`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
