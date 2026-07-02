// Pure candidate selection for ai-food responses. Callers append candidates
// in tier-priority order (personal -> USDA -> OpenFoodFacts -> web); this
// only dedupes and splits best-vs-alternatives. No Deno APIs (vitest-tested).

import type { AiFood } from "./macros.ts";

export function pickCandidates(
  candidates: AiFood[],
  maxAlternatives = 3,
): { food: AiFood; alternatives: AiFood[] } | null {
  const seen = new Set<string>();
  const unique: AiFood[] = [];
  for (const c of candidates) {
    const key = c.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }
  if (unique.length === 0) return null;
  return { food: unique[0], alternatives: unique.slice(1, 1 + maxAlternatives) };
}
