// ai-food: turns a food/meal description into macros, GROUNDED in real
// nutrition databases.
//
// Flow: DeepSeek thinking mode interprets the query (food name + portion + a fallback
// estimate) -> we look the food up in USDA and OpenFoodFacts -> if found we
// return those real per-100g macros scaled to the portion (source: usda/
// openfoodfacts); if not found we fall back to DeepSeek's estimate, clearly
// flagged (source: ai_estimate).
//
// Security: DeepSeek key is server-only. The user is authed from their JWT.
// Per-minute rate limiting + monthly/daily quota are enforced here.
//
// Response contract:
//   200 { food }                                   success (grounded or estimate)
//   200 { error: "rate_limited" }                  too many requests this minute
//   200 { error: "over_free_quota" | "over_pro_cap" }   quota denial
//   400 { error: "bad_request" } | 401 { error: "unauthorized" }
//   502 { error: "ai_unavailable" }

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { validateAndNormalize, scaleToServing, type AiFood, type Per100 } from "../_shared/macros.ts";
import { currentPeriod, isProActive, decideQuota, isRateLimited } from "../_shared/quota.ts";
import { buildUsdaSearchTerms } from "../_shared/foodSearch.ts";
import { pickCandidates } from "../_shared/candidates.ts";
import { buildTavilyQuery, parseWebCandidates } from "../_shared/webNutrition.ts";

const FREE_MONTHLY = 7;
const PRO_DAILY = 100;
const RATE_PER_MIN = 15;
const MAX_QUERY = 200;
const DEEPSEEK_MODEL = "deepseek-v4-flash";
// Web-mode ("Find more") uses the bigger model: judgment over messy web
// snippets is where it earns its ~4x cost. One-line A/B switch.
const DEEPSEEK_WEB_MODEL = "deepseek-v4-pro";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT =
  `You convert a food or meal description into JSON for a nutrition-database lookup. ` +
  `Return ONLY JSON matching: {"name":string,"search_term":string,"serving_label":string,` +
  `"serving_grams":number,"estimate":{"kcal":number,"protein":number,"carbs":number,"fat":number},` +
  `"notes"?:string}. ` +
  `name: a clean display name. search_term: the core food name to look up (NO quantities/brands), ` +
  `e.g. "egg", "chicken adobo". serving_label + serving_grams: the portion the user asked for ` +
  `(grams for the whole serving). estimate: your best PER-SERVING macro estimate, used only as a ` +
  `fallback if the databases have nothing.`;

const WEB_SYSTEM_PROMPT =
  `You extract nutrition candidates for a food from web search results. ` +
  `Return ONLY JSON: {"candidates":[{"name":string,"url":string,"serving_label":string,` +
  `"serving_grams":number,"kcal":number,"protein":number,"carbs":number,"fat":number,` +
  `"notes"?:string}]} with up to 4 candidates ordered best-match-first for the user's request. ` +
  `Use ONLY nutrition numbers present in the search results, scaled to the requested portion. ` +
  `"url" MUST be the exact URL of the search result the numbers came from. ` +
  `Prefer official brand sites and established nutrition databases when results disagree. ` +
  `If no result contains usable nutrition data, return {"candidates":[]}.`;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const numOr = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Extract per-100g macros from a USDA FoodData Central food (as returned by the
// usda-search function). Returns null if it carries no usable nutrition.
function usdaPer100(food: Record<string, unknown>): Per100 | null {
  const ns = Array.isArray(food?.foodNutrients) ? (food.foodNutrients as Record<string, unknown>[]) : [];
  const get = (id: number) => {
    const v = ns.find((n) => n?.nutrientId === id)?.value;
    return Number.isFinite(v) ? Number(v) : 0;
  };
  const kcal = get(1008) || Math.round(get(1062) / 4.184);
  const protein = get(1003);
  const carbs = get(1005);
  const fat = get(1004);
  if (kcal <= 0 && protein <= 0 && carbs <= 0 && fat <= 0) return null;
  return { kcal, protein, carbs, fat };
}

// Tier 0 "memory": the user's own saved foods. A match means the system
// remembers what they logged before — return it directly (no AI cost).
async function personalTop(
  admin: SupabaseClient,
  userId: string,
  term: string,
  grams: number,
): Promise<AiFood | null> {
  try {
    const { data } = await admin
      .from("personal_foods")
      .select("name, calories, protein, carbs, fat, default_unit")
      .eq("user_id", userId)
      .ilike("name", `%${term}%`)
      .limit(1);
    const f = data?.[0];
    if (!f) return null;

    const unit = String(f.default_unit ?? "serving");
    const per100: Per100 = {
      kcal: numOr(f.calories, 0),
      protein: numOr(f.protein, 0),
      carbs: numOr(f.carbs, 0),
      fat: numOr(f.fat, 0),
    };
    // Weight-based saved foods store per-100g and can be scaled; unit-based
    // foods (serving/cup/...) store per-1 and are returned as a single unit.
    const isWeight = unit === "g" || unit === "ml" || unit === "oz";
    if (isWeight) {
      return {
        name: String(f.name),
        serving_label: `${grams} ${unit}`,
        serving_grams: grams,
        ...scaleToServing(per100, grams),
        confidence: "high",
        source: "my_food",
      };
    }
    return {
      name: String(f.name),
      serving_label: `1 ${unit}`,
      serving_grams: 100,
      ...per100,
      confidence: "high",
      source: "my_food",
    };
  } catch {
    return null;
  }
}

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

async function offCandidates(term: string): Promise<{ per100: Per100; name: string }[]> {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: "unauthorized" });

  let body: { query?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const query = typeof body.query === "string" ? body.query.trim().slice(0, MAX_QUERY) : "";
  if (!query) return json(400, { error: "bad_request" });
  const webMode = body.mode === "web";

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const period = currentPeriod(now);
  const dayPeriod = `${period}-${String(now.getUTCDate()).padStart(2, "0")}`;
  const minutePeriod =
    `${dayPeriod}T${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;

  // --- Rate limit (per-minute abuse throttle, counts attempts) ---
  const { data: minRow } = await admin
    .from("ai_usage").select("count").eq("user_id", user.id).eq("period", minutePeriod).maybeSingle();
  if (isRateLimited(minRow?.count ?? 0, RATE_PER_MIN)) return json(200, { error: "rate_limited" });
  await admin.rpc("increment_ai_usage", { p_user: user.id, p_period: minutePeriod });

  // --- Quota (monthly free / daily pro) ---
  const { data: ent } = await admin
    .from("entitlements").select("pro_until").eq("user_id", user.id).maybeSingle();
  const pro = isProActive(ent?.pro_until ?? null, now);
  const { data: monthRow } = await admin
    .from("ai_usage").select("count").eq("user_id", user.id).eq("period", period).maybeSingle();
  const { data: dayRow } = await admin
    .from("ai_usage").select("count").eq("user_id", user.id).eq("period", dayPeriod).maybeSingle();
  const decision = decideQuota({
    isPro: pro,
    monthCount: monthRow?.count ?? 0,
    dayCount: dayRow?.count ?? 0,
    freeMonthly: FREE_MONTHLY,
    proDaily: PRO_DAILY,
  });
  if (!decision.allowed) return json(200, { error: decision.reason });

  // --- 1. DeepSeek: interpret the query + produce a fallback estimate ---
  let interp: Record<string, unknown>;
  try {
    const dsRes = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("DEEPSEEK_API_KEY")!}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
        thinking: { type: "enabled", reasoning_effort: "medium" },
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
    if (!dsRes.ok) return json(502, { error: "ai_unavailable" });
    const dsJson = await dsRes.json();
    interp = JSON.parse(dsJson.choices?.[0]?.message?.content ?? "null");
  } catch {
    return json(502, { error: "ai_unavailable" });
  }
  if (!interp || typeof interp !== "object") return json(502, { error: "ai_unavailable" });

  const term = String(interp.search_term ?? interp.name ?? query).slice(0, 100);
  const grams = numOr(interp.serving_grams, 100);
  const servingLabel = String(interp.serving_label ?? "1 serving");
  const displayName = String(interp.name ?? term) || "Food";

  let food: AiFood | null = null;
  let alternatives: AiFood[] = [];

  if (webMode) {
    // --- 2w. Web escalation ("Find more"): one Tavily search + v4-pro
    // extraction over the results. User-triggered only. ---
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
        // fall through to the estimate fallback below
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
    // Personal foods (memory) -> USDA -> OpenFoodFacts. The best candidate
    // keeps the AI's clean display name; alternatives keep the database entry
    // name so the user can tell them apart (e.g. cooked vs raw rice).
    const candidates: AiFood[] = [];
    const personal = await personalTop(admin, user.id, term, grams);
    if (personal) candidates.push(personal);

    const usda = await usdaCandidates(admin, term);
    const off = usda.length < 3 ? await offCandidates(term) : [];
    const grounded = [
      ...usda.map((hit) => ({ hit, source: "usda" as const })),
      ...off.map((hit) => ({ hit, source: "openfoodfacts" as const })),
    ];
    for (const { hit, source } of grounded) {
      const isBest = candidates.length === 0;
      candidates.push({
        name: isBest ? displayName : hit.name,
        serving_label: servingLabel,
        serving_grams: grams,
        ...scaleToServing(hit.per100, grams),
        confidence: "high",
        source,
        source_detail: hit.name,
      });
    }

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
  }
  if (!food) return json(502, { error: "ai_unavailable" });

  // --- 3. Count the successful lookup against quota ---
  await admin.rpc("increment_ai_usage", { p_user: user.id, p_period: period });
  await admin.rpc("increment_ai_usage", { p_user: user.id, p_period: dayPeriod });

  return json(200, { food, alternatives });
});
