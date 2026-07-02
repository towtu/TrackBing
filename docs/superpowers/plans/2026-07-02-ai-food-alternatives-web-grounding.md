# AI Food Alternatives + "Find more" Web Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `ai-food` pipeline returns a best match **plus up to 3 tappable alternatives**, and a user-triggered `mode: "web"` escalation runs one Tavily search + DeepSeek v4-pro extraction for foods the free databases don't know.

**Architecture:** Extend the existing `ai-food` Supabase edge function (shared auth/rate-limit/quota — no new function). Candidate collection and web-result parsing live in pure, Deno-free helpers under `supabase/functions/_shared/` so vitest covers them. Client wrapper gains `alternatives` + `mode: "web"`; `AiFoodSheet` and `BeeQuickLog` render alternatives and a "Find more" action.

**Tech Stack:** Expo React Native + TypeScript (strict), Supabase edge functions (Deno), DeepSeek API (`deepseek-v4-flash` normal / `deepseek-v4-pro` web mode), Tavily search API, vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-02-ai-food-alternatives-web-grounding-design.md`
- Branch: `feat/ai-macros`. Commits authored by towtu <fatowtu123@gmail.com>, conventional messages, **no AI co-author trailers**.
- Web search is user-triggered only (`mode: "web"`); never automatic.
- All candidates pass `validateAndNormalize` before leaving the server.
- `TAVILY_API_KEY` and `DEEPSEEK_API_KEY` are server-only Supabase secrets — never in client code.
- Checks that must stay green: `npm run typecheck`, `npm test`, `npm run lint`.
- Vitest has no config file — it auto-discovers `*.test.ts` including `supabase/functions/_shared/`.
- Max 3 alternatives in responses. Web mode counts as 1 AI use (existing quota path, unchanged).

---

### Task 0: Commit in-flight working-tree changes

The tree has uncommitted Bee quick-log work (Codex's). It must be committed before feature work so diffs stay clean.

**Files:**
- Modify: `.gitignore` (add `supabase/.temp/` if missing)
- Commit (already modified, do not edit): `src/components/ai/AiEstimateBadge.tsx`, `src/components/ai/BeeQuickLog.tsx`, `src/lib/aiFood.ts`, `src/lib/beeQuickLog.test.ts`, `src/lib/beeQuickLog.ts`, `src/screens/DashboardScreen.tsx`, `supabase/functions/_shared/macros.ts`, `src/lib/foodLogEvents.ts`, `src/lib/foodLogEvents.test.ts`
- Leave untracked: `codex.diff` (scratch file, not ours to commit or delete)

- [ ] **Step 1: Verify the in-flight work passes checks**

Run: `npm run typecheck && npm test`
Expected: both pass. If they fail, STOP and report — do not commit broken work.

- [ ] **Step 2: Ignore supabase/.temp**

Run: `grep -qx 'supabase/.temp/' .gitignore || echo 'supabase/.temp/' >> .gitignore`

- [ ] **Step 3: Commit**

```bash
git add .gitignore src/components/ai/AiEstimateBadge.tsx src/components/ai/BeeQuickLog.tsx \
  src/lib/aiFood.ts src/lib/beeQuickLog.test.ts src/lib/beeQuickLog.ts \
  src/screens/DashboardScreen.tsx supabase/functions/_shared/macros.ts \
  src/lib/foodLogEvents.ts src/lib/foodLogEvents.test.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: bee quick log polish and food log change events"
```

Expected: clean `git status` except `codex.diff` and plan/spec docs.

---

### Task 1: `source_detail` provenance field in shared macros

**Files:**
- Modify: `supabase/functions/_shared/macros.ts`
- Modify: `src/lib/aiFood.ts` (type only)
- Test: `supabase/functions/_shared/macros.test.ts`

**Interfaces:**
- Produces: `AiFood.source_detail?: string` (both server + client types); `validateAndNormalize` passes it through (trimmed, capped at 120 chars).

- [ ] **Step 1: Write the failing test** — append to `supabase/functions/_shared/macros.test.ts`:

```ts
describe("source_detail passthrough", () => {
  it("keeps a trimmed source_detail", () => {
    const food = validateAndNormalize({
      name: "Cheesedog", serving_label: "1 piece", serving_grams: 35,
      kcal: 105, protein: 4, carbs: 3, fat: 8.5,
      source: "web", source_detail: "  tenderjuicy.com.ph  ",
    });
    expect(food?.source_detail).toBe("tenderjuicy.com.ph");
  });

  it("omits source_detail when absent or not a string", () => {
    const food = validateAndNormalize({
      name: "Egg", serving_label: "1 large", serving_grams: 50,
      kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8,
      source: "usda", source_detail: 42,
    });
    expect(food?.source_detail).toBeUndefined();
  });

  it("caps source_detail at 120 chars", () => {
    const food = validateAndNormalize({
      name: "Egg", serving_label: "1 large", serving_grams: 50,
      kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8,
      source: "usda", source_detail: "x".repeat(300),
    });
    expect(food?.source_detail).toHaveLength(120);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/macros.test.ts`
Expected: FAIL — `source_detail` is `undefined` where `"tenderjuicy.com.ph"` expected (property doesn't exist yet).

- [ ] **Step 3: Implement** — in `supabase/functions/_shared/macros.ts`:

Add to the `AiFood` type (after `source: FoodSource;`):

```ts
  source_detail?: string;
```

Add to the object returned by `validateAndNormalize` (after `source: ...`):

```ts
    source_detail:
      typeof r.source_detail === "string"
        ? r.source_detail.trim().slice(0, 120) || undefined
        : undefined,
```

In `src/lib/aiFood.ts`, add the same `source_detail?: string;` line to its `AiFood` type (after `source: FoodSource;`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run supabase/functions/_shared/macros.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/macros.ts supabase/functions/_shared/macros.test.ts src/lib/aiFood.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: add source_detail provenance to AiFood"
```

---

### Task 2: Candidate collection helper

**Files:**
- Create: `supabase/functions/_shared/candidates.ts`
- Test: `supabase/functions/_shared/candidates.test.ts`

**Interfaces:**
- Consumes: `AiFood` from `./macros.ts` (Task 1 shape, with `source_detail`).
- Produces: `pickCandidates(candidates: AiFood[], maxAlternatives?: number): { food: AiFood; alternatives: AiFood[] } | null` — first element wins (callers append in tier-priority order), dedupes by lowercased name, caps alternatives (default 3), returns `null` for an empty list.

- [ ] **Step 1: Write the failing test** — create `supabase/functions/_shared/candidates.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickCandidates } from "./candidates";
import type { AiFood } from "./macros";

const mk = (name: string, kcal: number, source: AiFood["source"]): AiFood => ({
  name, serving_label: "100 g", serving_grams: 100,
  kcal, protein: 3, carbs: 28, fat: 0.3,
  confidence: "high", source,
});

describe("pickCandidates", () => {
  it("returns null for an empty list", () => {
    expect(pickCandidates([])).toBeNull();
  });

  it("keeps order: first candidate is the food, rest are alternatives", () => {
    const r = pickCandidates([
      mk("Rice, white, cooked", 130, "usda"),
      mk("Rice, white, raw", 365, "usda"),
      mk("Jasmine rice", 129, "openfoodfacts"),
    ]);
    expect(r?.food.name).toBe("Rice, white, cooked");
    expect(r?.alternatives.map((a) => a.name)).toEqual([
      "Rice, white, raw",
      "Jasmine rice",
    ]);
  });

  it("dedupes by name case-insensitively", () => {
    const r = pickCandidates([
      mk("White Rice", 130, "usda"),
      mk("white rice", 132, "openfoodfacts"),
      mk("Brown rice", 123, "usda"),
    ]);
    expect(r?.alternatives).toHaveLength(1);
    expect(r?.alternatives[0].name).toBe("Brown rice");
  });

  it("caps alternatives at 3 by default", () => {
    const r = pickCandidates(
      ["a", "b", "c", "d", "e"].map((n, i) => mk(n, 100 + i, "usda")),
    );
    expect(r?.alternatives).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/candidates.test.ts`
Expected: FAIL — cannot resolve `./candidates`.

- [ ] **Step 3: Implement** — create `supabase/functions/_shared/candidates.ts`:

```ts
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
```

Note: import specifier must be `./macros.ts` (with extension) — the Deno edge runtime requires it, and vitest resolves it fine (existing `_shared` files follow this pattern; verify with `head -5 supabase/functions/_shared/quota.ts` and match whichever style it uses).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/_shared/candidates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/candidates.ts supabase/functions/_shared/candidates.test.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: add pure candidate selection helper for ai-food"
```

---

### Task 3: Web-nutrition parsing helper

**Files:**
- Create: `supabase/functions/_shared/webNutrition.ts`
- Test: `supabase/functions/_shared/webNutrition.test.ts`

**Interfaces:**
- Consumes: `validateAndNormalize`, `AiFood` from `./macros.ts`.
- Produces:
  - `domainOf(url: string): string | null` — hostname without `www.`, null on invalid URL.
  - `buildTavilyQuery(term: string): string` — `` `${term} nutrition facts calories protein carbs fat` ``.
  - `parseWebCandidates(raw: unknown, opts: { grams: number; servingLabel: string; resultUrls: string[] }): AiFood[]` — parses v4-pro output `{ candidates: [{ name, url, serving_label?, serving_grams?, kcal, protein, carbs, fat, notes? }] }`; drops any candidate whose `url` domain is not among `resultUrls` domains (anti-hallucination); each survivor goes through `validateAndNormalize` with `source: "web"`, `source_detail: domainOf(url)`; caps at 4; returns `[]` on junk.

- [ ] **Step 1: Write the failing test** — create `supabase/functions/_shared/webNutrition.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/_shared/webNutrition.test.ts`
Expected: FAIL — cannot resolve `./webNutrition`.

- [ ] **Step 3: Implement** — create `supabase/functions/_shared/webNutrition.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/_shared/webNutrition.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/webNutrition.ts supabase/functions/_shared/webNutrition.test.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: add web nutrition parsing helper with URL allowlist"
```

---

### Task 4: Edge function — alternatives in normal mode

**Files:**
- Modify: `supabase/functions/ai-food/index.ts`

No direct unit tests (Deno runtime); all new logic beyond plumbing lives in the Task 2/3 helpers. Verification is typecheck-by-deploy in Task 6 plus manual checks in Task 9.

**Interfaces:**
- Consumes: `pickCandidates` (Task 2).
- Produces: response body `{ food: AiFood, alternatives: AiFood[] }` for normal mode. `source_detail` = matched USDA description / OFF product name. Alternatives use the database entry name as display name.

- [ ] **Step 1: Rework the resolution section of `supabase/functions/ai-food/index.ts`**

Add import at top (with the other `_shared` imports):

```ts
import { pickCandidates } from "../_shared/candidates.ts";
```

Replace `usdaTop` with a multi-candidate version:

```ts
async function usdaCandidates(
  admin: SupabaseClient,
  term: string,
): Promise<{ per100: Per100; name: string }[]> {
  try {
    for (const query of buildUsdaSearchTerms(term)) {
      const { data } = await admin.functions.invoke<{ foods?: unknown }>("usda-search", {
        body: { query, pageSize: 5 },
      });
      const foods = Array.isArray(data?.foods) ? (data!.foods as Record<string, unknown>[]) : [];
      const out: { per100: Per100; name: string }[] = [];
      for (const food of foods) {
        const per100 = usdaPer100(food);
        if (per100) out.push({ per100, name: String(food.description ?? term) });
        if (out.length >= 3) break;
      }
      if (out.length > 0) return out;
    }
  } catch {
    // fall through to OpenFoodFacts
  }
  return [];
}
```

Replace `offTop` with a multi-candidate version (same fetch, collect up to 2):

```ts
async function offCandidates(
  term: string,
): Promise<{ per100: Per100; name: string }[]> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
        term,
      )}&search_simple=1&action=process&json=1&page_size=5&lc=en`,
    );
    const data = await res.json();
    const products = Array.isArray(data?.products) ? data.products : [];
    const out: { per100: Per100; name: string }[] = [];
    for (const p of products) {
      const n = p?.nutriments ?? {};
      const per100: Per100 = {
        kcal: numOr(n["energy-kcal_100g"], 0),
        protein: numOr(n["proteins_100g"], 0),
        carbs: numOr(n["carbohydrates_100g"], 0),
        fat: numOr(n["fat_100g"], 0),
      };
      if (per100.kcal > 0 || per100.protein > 0 || per100.carbs > 0 || per100.fat > 0) {
        const brand = typeof p.brands === "string" && p.brands.trim()
          ? ` (${p.brands.split(",")[0].trim()})`
          : "";
        out.push({ per100, name: `${String(p.product_name || term)}${brand}` });
        if (out.length >= 2) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}
```

Replace the `--- 2. Resolve ... ---` block (the `let food: AiFood | null = ...` section through `if (!food) return json(502, ...)`) with:

```ts
  // --- 2. Resolve: collect candidates across tiers, best first ---
  // Personal foods (memory) -> USDA -> OpenFoodFacts. The best candidate keeps
  // the AI's clean display name; alternatives keep the database entry name so
  // the user can tell them apart (e.g. cooked vs raw rice).
  const candidates: AiFood[] = [];
  const personal = await personalTop(admin, user.id, term, grams);
  if (personal) candidates.push(personal);

  const usda = await usdaCandidates(admin, term);
  const off = usda.length < 3 ? await offCandidates(term) : [];
  for (const hit of [...usda, ...off]) {
    const scaled = scaleToServing(hit.per100, grams);
    const isBest = candidates.length === 0;
    candidates.push({
      name: isBest ? displayName : hit.name,
      serving_label: servingLabel,
      serving_grams: grams,
      ...scaled,
      confidence: "high",
      source: usda.includes(hit as (typeof usda)[number]) ? "usda" : "openfoodfacts",
      source_detail: hit.name,
    });
  }

  let food: AiFood | null = null;
  let alternatives: AiFood[] = [];
  const picked = pickCandidates(candidates);
  if (picked) {
    food = picked.food;
    alternatives = picked.alternatives;
  } else {
    const est = (interp.estimate ?? {}) as Record<string, unknown>;
    food = validateAndNormalize({
      name: displayName,
      serving_label: servingLabel,
      serving_grams: grams,
      kcal: est.kcal,
      protein: est.protein,
      carbs: est.carbs,
      fat: est.fat,
      confidence: "low",
      source: "ai_estimate",
      notes: "Not found in nutrition databases — estimated.",
    });
  }
  if (!food) return json(502, { error: "ai_unavailable" });
```

And change the final response line to:

```ts
  return json(200, { food, alternatives });
```

Note the dedupe subtlety: the best candidate uses `displayName` while a same-entry alternative would use `hit.name`, so `pickCandidates`'s name dedupe won't catch that pair — that's fine, because `source_detail` is the same and the first USDA hit is only added once (the loop adds each hit exactly once; there is no duplicate pair to worry about).

- [ ] **Step 2: Sanity-check the function compiles under Deno**

Run: `deno check supabase/functions/ai-food/index.ts 2>/dev/null || npx supabase functions serve ai-food --no-verify-jwt & sleep 5; kill %1 2>/dev/null`
Preferred: `deno check` if deno is installed; otherwise rely on `supabase functions deploy` in Task 6 (deploy fails on type errors). If neither is possible locally, proceed — Task 6 gates it.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-food/index.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: return alternative candidates from ai-food"
```

---

### Task 5: Edge function — `mode: "web"` (Tavily + v4-pro)

**Files:**
- Modify: `supabase/functions/ai-food/index.ts`

**Interfaces:**
- Consumes: `buildTavilyQuery`, `parseWebCandidates` (Task 3), `pickCandidates` (Task 2).
- Produces: `POST { query, mode: "web" }` → `{ food, alternatives }` with `source: "web"` + `source_detail` domains; falls back to `ai_estimate` when Tavily/v4-pro yields nothing usable. Same rate-limit + quota path as normal mode.

- [ ] **Step 1: Add web-mode constants, prompt, and Tavily helper** — in `supabase/functions/ai-food/index.ts`:

Import (extend the Task 3 helper import):

```ts
import { buildTavilyQuery, parseWebCandidates } from "../_shared/webNutrition.ts";
```

Below `const DEEPSEEK_MODEL = "deepseek-v4-flash";` add:

```ts
// Web-mode ("Find more") uses the bigger model: judgment over messy web
// snippets is where it earns its ~4x cost. One-line A/B switch.
const DEEPSEEK_WEB_MODEL = "deepseek-v4-pro";
```

Below `SYSTEM_PROMPT` add:

```ts
const WEB_SYSTEM_PROMPT =
  `You extract nutrition candidates for a food from web search results. ` +
  `Return ONLY JSON: {"candidates":[{"name":string,"url":string,"serving_label":string,` +
  `"serving_grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,` +
  `"notes"?:string}]} with up to 4 candidates ordered best-match-first for the user's request. ` +
  `Use ONLY nutrition numbers present in the search results, scaled to the requested portion. ` +
  `"url" MUST be the exact URL of the search result the numbers came from. ` +
  `Prefer official brand sites and established nutrition databases when results disagree. ` +
  `If no result contains usable nutrition data, return {"candidates":[]}.`;
```

Near the other helpers add:

```ts
type TavilyResult = { url: string; title: string; content: string };

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const key = Deno.env.get("TAVILY_API_KEY");
  if (!key) return [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query, max_results: 6, search_depth: "basic" }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results
      .map((r: Record<string, unknown>) => ({
        url: String(r?.url ?? ""),
        title: String(r?.title ?? ""),
        content: String(r?.content ?? ""),
      }))
      .filter((r: TavilyResult) => r.url && r.content);
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Read `mode` from the body and branch after interpretation**

Where the body is parsed, extend:

```ts
  let body: { query?: unknown; mode?: unknown };
```

and after the `query` extraction add:

```ts
  const webMode = body.mode === "web";
```

After the `displayName` line (the flash interpretation is shared by both modes) insert the web branch, replacing nothing — normal mode code from Task 4 stays as the `else` path. Structure:

```ts
  let food: AiFood | null = null;
  let alternatives: AiFood[] = [];

  if (webMode) {
    // --- 2w. Web escalation: one Tavily search + v4-pro extraction ---
    const results = await tavilySearch(buildTavilyQuery(term));
    if (results.length > 0) {
      const snippets = results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`)
        .join("\n\n")
        .slice(0, 8000);
      try {
        const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("DEEPSEEK_API_KEY")!}`,
          },
          body: JSON.stringify({
            model: DEEPSEEK_WEB_MODEL,
            messages: [
              { role: "system", content: WEB_SYSTEM_PROMPT },
              {
                role: "user",
                content:
                  `Request: ${query}\nPortion: ${servingLabel} (${grams} g)\n\nSearch results:\n${snippets}`,
              },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
        });
        if (dsRes.ok) {
          const dsJson = await dsRes.json();
          const parsed = JSON.parse(dsJson.choices?.[0]?.message?.content ?? "null");
          const webCands = parseWebCandidates(parsed, {
            grams,
            servingLabel,
            resultUrls: results.map((r) => r.url),
          });
          const picked = pickCandidates(webCands);
          if (picked) {
            food = picked.food;
            alternatives = picked.alternatives;
          }
        }
      } catch {
        // fall through to estimate fallback below
      }
    }
    if (!food) {
      // The user spent a quota credit — give them a reviewable estimate
      // rather than a hard error.
      const est = (interp.estimate ?? {}) as Record<string, unknown>;
      food = validateAndNormalize({
        name: displayName,
        serving_label: servingLabel,
        serving_grams: grams,
        kcal: est.kcal,
        protein: est.protein,
        carbs: est.carbs,
        fat: est.fat,
        confidence: "low",
        source: "ai_estimate",
        notes: "Web search found nothing usable — estimated.",
      });
    }
  } else {
    // --- 2. Resolve: collect candidates across tiers, best first ---
    // (Task 4 block goes here unchanged: personal -> usdaCandidates ->
    //  offCandidates -> pickCandidates -> estimate fallback)
  }

  if (!food) return json(502, { error: "ai_unavailable" });
```

(When editing, fold the Task 4 block into the `else`; declare `food`/`alternatives` once, above the branch.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ai-food/index.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: add user-triggered web grounding mode to ai-food"
```

---

### Task 6: Deploy the edge function

**Files:** none (deployment)

- [ ] **Step 1: Confirm the Tavily secret exists**

Run: `npx supabase secrets list | grep -i tavily`
Expected: `TAVILY_API_KEY` present (set on Jul 1). If missing, STOP and ask the user for the key.

- [ ] **Step 2: Deploy**

Run: `npx supabase functions deploy ai-food`
Expected: deploy succeeds (this also type-checks the Deno code; fix any errors it reports and redeploy).

- [ ] **Step 3: Commit any fixes made during deploy**

Only if Step 2 required code fixes:

```bash
git add supabase/functions/ai-food/index.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "fix: ai-food deploy type errors"
```

---

### Task 7: Client wrapper — alternatives + web mode

**Files:**
- Modify: `src/lib/aiFood.ts`
- Test: `src/lib/aiFood.test.ts` (append)

**Interfaces:**
- Produces:
  - `export type AiFoodMode = "auto" | "fill" | "web";`
  - `requestAiFood(query: string, mode: AiFoodMode = "auto")`
  - success shape `{ ok: true; food: AiFood; alternatives: AiFood[] }` (`alternatives` always an array, `[]` when the server omits it).
- Existing callers (`add.tsx`, `create-food.tsx`, `BeeQuickLog.tsx`) only read `result.food` — the added property is non-breaking.

- [ ] **Step 1: Write the failing tests** — append to `src/lib/aiFood.test.ts`, following that file's existing mock pattern for `supabase.functions.invoke` (read the file first and reuse its helpers/mocks):

```ts
it("returns alternatives from the response, defaulting to []", async () => {
  mockInvoke.mockResolvedValueOnce({
    data: { food: FOOD, alternatives: [ALT] },
    error: null,
  });
  const r = await requestAiFood("60g white rice");
  expect(r).toEqual({ ok: true, food: FOOD, alternatives: [ALT] });

  mockInvoke.mockResolvedValueOnce({ data: { food: FOOD }, error: null });
  const r2 = await requestAiFood("60g white rice");
  expect(r2.ok && r2.alternatives).toEqual([]);
});

it("sends mode web to the edge function", async () => {
  mockInvoke.mockResolvedValueOnce({ data: { food: FOOD }, error: null });
  await requestAiFood("tender juicy cheesedog", "web");
  expect(mockInvoke).toHaveBeenCalledWith("ai-food", {
    body: { query: "tender juicy cheesedog", mode: "web" },
  });
});
```

(`FOOD`/`ALT` are AiFood literals — define `ALT` next to the file's existing food fixture, e.g. `{ ...FOOD, name: "Rice, white, raw", kcal: 365 }`. Adapt the mock variable name to what the file actually uses.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/aiFood.test.ts`
Expected: FAIL — result has no `alternatives` property.

- [ ] **Step 3: Implement** — in `src/lib/aiFood.ts`:

```ts
export type AiFoodMode = "auto" | "fill" | "web";

export type AiFoodResult =
  | { ok: true; food: AiFood; alternatives: AiFood[] }
  | { ok: false; reason: AiFoodReason };

export async function requestAiFood(
  query: string,
  mode: AiFoodMode = "auto",
): Promise<AiFoodResult> {
  try {
    const { data, error } = await supabase.functions.invoke<{
      food?: AiFood;
      alternatives?: AiFood[];
      error?: string;
    }>("ai-food", { body: { query, mode } });
    if (data?.food) {
      return {
        ok: true,
        food: data.food,
        alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
      };
    }
    const bodyReason = toAiFoodReason(data?.error);
    if (bodyReason) return { ok: false, reason: bodyReason };

    const errorReason = await reasonFromFunctionError(error);
    if (errorReason) return { ok: false, reason: errorReason };

    return { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/lib/aiFood.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aiFood.ts src/lib/aiFood.test.ts
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: expose alternatives and web mode in ai-food client"
```

---

### Task 8: AiFoodSheet — alternatives, source detail, Find more

**Files:**
- Modify: `src/components/ai/AiFoodSheet.tsx`
- Modify: `app/(tabs)/add.tsx`

**Interfaces:**
- Consumes: `requestAiFood(query, "web")`, `AiFood.source_detail`.
- Produces: `AiFoodSheet` props gain `alternatives?: AiFood[]`, `onSelectAlternative?: (alt: AiFood) => void`, `onFindMore?: () => Promise<void>`. All optional — existing usage stays valid.

- [ ] **Step 1: Extend AiFoodSheet** — in `src/components/ai/AiFoodSheet.tsx`:

Props:

```ts
type Props = {
  visible: boolean;
  food: AiFood | null;
  alternatives?: AiFood[];
  onSelectAlternative?: (alt: AiFood) => void;
  onFindMore?: () => Promise<void>;
  onClose: () => void;
  onSave: (edited: AiFood, opts: AiFoodSaveOpts) => Promise<void>;
};

export function AiFoodSheet({
  visible, food, alternatives = [], onSelectAlternative, onFindMore, onClose, onSave,
}: Props) {
```

Add state next to `saving`:

```ts
  const [findingMore, setFindingMore] = useState(false);
```

Source-detail line — inside the `BeeGuide` `footer`, after the `provenanceRow` `</View>`, wrap footer content in a fragment:

```tsx
              footer={
                <>
                  <View style={styles.provenanceRow}>
                    <AiEstimateBadge source={food.source} compact />
                    <Text style={[styles.confidence, { color: CONFIDENCE_COLOR[food.confidence] }]}>
                      {food.confidence} confidence
                    </Text>
                  </View>
                  {food.source_detail ? (
                    <Text style={styles.sourceDetail}>
                      {food.source === "web" ? "from " : "matched: "}
                      {food.source_detail}
                    </Text>
                  ) : null}
                </>
              }
```

Alternatives + Find more — insert between the `{food.notes ? ...}` line and the `<View style={styles.actions}>` block:

```tsx
            {alternatives.length > 0 && onSelectAlternative ? (
              <View style={styles.altSection}>
                <Text style={styles.altTitle}>Other matches</Text>
                {alternatives.map((alt) => (
                  <Pressable
                    key={`${alt.source}-${alt.name}`}
                    style={styles.altRow}
                    disabled={saving || findingMore}
                    onPress={() => onSelectAlternative(alt)}
                  >
                    <View style={styles.altInfo}>
                      <Text style={styles.altName} numberOfLines={1}>{alt.name}</Text>
                      <Text style={styles.altMacros}>
                        {alt.kcal} kcal · P{alt.protein} C{alt.carbs} F{alt.fat}
                      </Text>
                    </View>
                    <AiEstimateBadge source={alt.source} compact />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {onFindMore ? (
              <Pressable
                style={[styles.btn, styles.btnFindMore]}
                disabled={saving || findingMore}
                onPress={async () => {
                  setFindingMore(true);
                  try {
                    await onFindMore();
                  } finally {
                    setFindingMore(false);
                  }
                }}
              >
                {findingMore ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : (
                  <Text style={styles.btnFindMoreText}>
                    🔎 Not right? Find more on the web (1 AI use)
                  </Text>
                )}
              </Pressable>
            ) : null}
```

Styles to add to the StyleSheet:

```ts
  sourceDetail: { color: Colors.textMuted, fontSize: 11, fontWeight: "600", marginTop: 8 },
  altSection: { marginTop: 18 },
  altTitle: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
  },
  altRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  altInfo: { flex: 1, minWidth: 0 },
  altName: { color: Colors.text, fontSize: 13, fontWeight: "800" },
  altMacros: { color: Colors.textSecondary, fontSize: 11, fontWeight: "700", marginTop: 2 },
  btnFindMore: {
    marginTop: 14, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  btnFindMoreText: { color: Colors.accent, fontWeight: "800", fontSize: 13 },
```

Also disable the other buttons while `findingMore`: change each `disabled={saving}` in the sheet to `disabled={saving || findingMore}`.

- [ ] **Step 2: Wire add.tsx** — in `app/(tabs)/add.tsx`:

Next to the existing `aiFoodProposal` state (search for `setAiFoodProposal` to find it), add:

```ts
  const [aiAlternatives, setAiAlternatives] = useState<AiFood[]>([]);
  const [aiQuery, setAiQuery] = useState("");
```

(`AiFood` may need adding to the `@/src/lib/aiFood` import.)

In `handleBeeLookup`, on success:

```ts
    if (result.ok) {
      setAiQuery(trimmed);
      setAiFoodProposal(result.food);
      setAiAlternatives(result.alternatives);
      return;
    }
```

Add a handler near `handleBeeLookup`:

```ts
  const handleAiFindMore = async () => {
    if (!aiQuery) return;
    const result = await requestAiFood(aiQuery, "web");
    if (result.ok) {
      setAiFoodProposal(result.food);
      setAiAlternatives(result.alternatives);
      return;
    }
    setFeedback(getAiFoodFeedback(result.reason));
  };
```

Update the JSX:

```tsx
        <AiFoodSheet
          visible={!!aiFoodProposal}
          food={aiFoodProposal}
          alternatives={aiAlternatives}
          onSelectAlternative={(alt) => setAiFoodProposal(alt)}
          onFindMore={handleAiFindMore}
          onClose={() => {
            setAiFoodProposal(null);
            setAiAlternatives([]);
          }}
          onSave={handleAiFoodSave}
        />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass (lint may report pre-existing warnings only — no new ones).

- [ ] **Step 4: Commit**

```bash
git add src/components/ai/AiFoodSheet.tsx "app/(tabs)/add.tsx"
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: show alternatives, source detail, and Find more in AI food sheet"
```

---

### Task 9: BeeQuickLog — alternatives chips + Find more

**Files:**
- Modify: `src/components/ai/BeeQuickLog.tsx`

**Interfaces:**
- Consumes: `requestAiFood(query, "web")`, `result.alternatives`, `AiFood.source_detail`.

- [ ] **Step 1: Track alternatives + last query** — in `src/components/ai/BeeQuickLog.tsx`, next to `pendingFood`:

```ts
  const [pendingAlternatives, setPendingAlternatives] = useState<AiFood[]>([]);
  const [lastQuery, setLastQuery] = useState("");
```

In `resolveAndReview`, on success (after `setPendingFood(result.food);`):

```ts
    setPendingAlternatives(result.alternatives);
    setLastQuery(query);
```

Clear both wherever `setPendingFood(null)` is called after logging or "Not right" (in `logFood` success path and the "Not right" chip handler):

```ts
    setPendingAlternatives([]);
```

(Do NOT clear `lastQuery` on "Not right" — "Find more" is most useful right after a bad match. Clear it only implicitly by the next `resolveAndReview`.)

- [ ] **Step 2: Web escalation handler** — add next to `resolveAndReview`:

```ts
  const findMoreOnWeb = async () => {
    if (!lastQuery || loading) return;
    setLoading(true);
    setPendingFood(null);
    setPendingAlternatives([]);
    appendMessages([
      {
        id: createId("bee"),
        role: "bee",
        text: "Searching the web for a better match (this uses 1 AI credit)...",
      },
    ]);

    const result = await requestAiFood(lastQuery, "web");
    setLoading(false);
    if (!result.ok) {
      const aiFeedback = getAiFoodFeedback(result.reason);
      appendMessages([{ id: createId("bee"), role: "bee", text: aiFeedback.message }]);
      setFeedback(aiFeedback);
      return;
    }

    setPendingFood(result.food);
    setPendingAlternatives(result.alternatives);
    appendMessages([
      {
        id: createId("bee"),
        role: "bee",
        food: result.food,
        text: `From the web: ${result.food.serving_label} of ${result.food.name} — ${Math.round(
          result.food.kcal,
        )} kcal, P${Math.round(result.food.protein)} C${Math.round(
          result.food.carbs,
        )} F${Math.round(result.food.fat)}. Better?`,
      },
    ]);
  };
```

- [ ] **Step 3: Render alternative chips + Find more chip** — replace the `reviewOptions` block (the `{reviewOptions.length > 0 ? ... : null}` JSX) with:

```tsx
              {pendingFood ? (
                <View style={styles.optionWrap}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    disabled={loading}
                    onPress={() => pendingFood && logFood(pendingFood)}
                    style={[styles.optionChip, styles.optionChipPrimary]}
                  >
                    <Text style={[styles.optionText, styles.optionTextPrimary]}>
                      Log it
                    </Text>
                  </TouchableOpacity>
                  {pendingAlternatives.map((alt) => (
                    <TouchableOpacity
                      key={`${alt.source}-${alt.name}`}
                      activeOpacity={0.82}
                      disabled={loading}
                      onPress={() => {
                        setPendingFood(alt);
                        appendMessages([
                          {
                            id: createId("bee"),
                            role: "bee",
                            food: alt,
                            text: `Swapped to ${alt.name}: ${Math.round(alt.kcal)} kcal, P${Math.round(
                              alt.protein,
                            )} C${Math.round(alt.carbs)} F${Math.round(alt.fat)}. Log it?`,
                          },
                        ]);
                      }}
                      style={styles.optionChip}
                    >
                      <Text style={styles.optionText} numberOfLines={1}>
                        {alt.name} · {Math.round(alt.kcal)} kcal
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {lastQuery ? (
                    <TouchableOpacity
                      activeOpacity={0.82}
                      disabled={loading}
                      onPress={findMoreOnWeb}
                      style={styles.optionChip}
                    >
                      <Text style={styles.optionText}>🔎 Find more</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    activeOpacity={0.82}
                    disabled={loading}
                    onPress={() => {
                      setPendingFood(null);
                      setPendingAlternatives([]);
                      appendMessages([
                        {
                          id: createId("bee"),
                          role: "bee",
                          text: "No problem. Type the correction and I will search again.",
                        },
                      ]);
                    }}
                    style={styles.optionChip}
                  >
                    <Text style={styles.optionText}>Not right</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
```

Delete the now-unused `const reviewOptions = pendingFood ? ["Log it", "Not right"] : [];` line.

- [ ] **Step 4: Show source_detail in message bubbles** — in the message `badgeRow`:

```tsx
                    {message.food ? (
                      <View style={styles.badgeRow}>
                        <AiEstimateBadge source={message.food.source} compact />
                        <Text style={styles.confidenceText}>
                          {message.food.confidence} confidence
                        </Text>
                        {message.food.source_detail ? (
                          <Text style={styles.sourceDetailText} numberOfLines={1}>
                            {message.food.source === "web" ? "from " : "matched: "}
                            {message.food.source_detail}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
```

Style:

```ts
  sourceDetailText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    flexShrink: 1,
  },
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ai/BeeQuickLog.tsx
git -c user.name="towtu" -c user.email="fatowtu123@gmail.com" commit -m "feat: bee quick log alternatives and web find-more"
```

---

### Task 10: Full verification

**Files:** none

- [ ] **Step 1: Full local gate**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all green (no new lint warnings vs. the pre-existing baseline).

- [ ] **Step 2: Browser verification (Expo web + Playwright)**

Start: `npx expo start --web --port 9100` (background). Then with Playwright:
- Open the app, sign in with the dev account (ask the user if credentials are needed).
- Dashboard → Bee quick log → type `60g white rice` → expect proposal + alternative chips (cooked/raw variants) + "🔎 Find more" chip.
- Type `70g tender juicy cheesedog` → likely `ai_estimate` or OFF result → tap "🔎 Find more" → expect a web-sourced result with `from <domain>` detail.
- Add tab → Bee lookup → verify the sheet shows "Other matches" rows, source detail line, and the Find more button; tap an alternative and confirm the fields re-seed.
- Screenshot at 375px and 1440px; report console errors and failed network requests.

- [ ] **Step 3: Report**

State exactly what was verified (including the security checklist against the diff) and the results of the hard queries: "steamed white rice", "tender juicy cheesedog", "adobong pusit".
