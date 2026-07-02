// Pure parsing of DeepSeek v4-pro output over Tavily search results into
// validated web-sourced AiFood candidates. Anti-hallucination rule: a
// candidate must cite a URL from the actual search results or it is dropped.
// No Deno APIs (vitest-tested).

import { validateAndNormalize, type AiFood } from "./macros.ts";

export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function buildTavilyQuery(term: string): string {
  return `${term} nutrition facts calories protein carbs fat`;
}

export function parseWebCandidates(
  raw: unknown,
  opts: { grams: number; servingLabel: string; resultUrls: string[] },
): AiFood[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).candidates;
  if (!Array.isArray(list)) return [];

  const allowed = new Set(
    opts.resultUrls.map(domainOf).filter((d): d is string => d !== null),
  );

  const out: AiFood[] = [];
  for (const item of list) {
    if (out.length >= 4) break;
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const domain = typeof c.url === "string" ? domainOf(c.url) : null;
    if (!domain || !allowed.has(domain)) continue;

    const food = validateAndNormalize({
      name: c.name,
      serving_label:
        typeof c.serving_label === "string" && c.serving_label.trim()
          ? c.serving_label
          : opts.servingLabel,
      serving_grams: Number.isFinite(Number(c.serving_grams))
        ? c.serving_grams
        : opts.grams,
      kcal: c.kcal,
      protein: c.protein,
      carbs: c.carbs,
      fat: c.fat,
      notes: c.notes,
      confidence: "medium",
      source: "web",
      source_detail: domain,
    });
    if (food) out.push(food);
  }
  return out;
}
