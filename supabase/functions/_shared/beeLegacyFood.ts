import { parseIntent, record, retainFoodList } from "./beeIntent.ts";
import { requestFingerprint } from "./beeService.ts";
import { readBoundedRequestJson } from "./beeRequest.ts";
import { isSafeGroundingUrl, validateSuggestionsHtml } from "./beeGrounding.ts";
import type { NutritionResult } from "./beeNutrition.ts";
import type { GeminiUsage } from "./beeProviders.ts";
import type { FoodQuery, GroundedAnswer, NutritionEvidence, Portion, ReviewedFood } from "./beeTypes.ts";
import type { AiFood } from "./macros.ts";
export { readBoundedRequestJson } from "./beeRequest.ts";

export type LegacyFoodRequest = { requestId: string; query: string; mode: "auto" | "fill" | "web" };
export type LegacyFood = AiFood & { evidence: NutritionEvidence; requested_portion: Portion; requested_query: FoodQuery };
export type LegacyFoodError = "needs_input" | "answer_only" | "bad_request" | "unauthorized" | "not_configured" | "ai_unavailable" | "search_unavailable" | "rate_limited" | "over_free_quota" | "over_pro_cap" | "busy" | "conflict";
export type LegacyFoodPayload = { food: LegacyFood; alternatives: LegacyFood[] } | { error: LegacyFoodError; message?: string; answer?: GroundedAnswer };
export interface LegacyFoodStore {
  reserve(request: LegacyFoodRequest, fingerprint: string, token: string): Promise<{ ok: true; replay: false } | { ok: true; replay: true; result: LegacyFoodPayload } | { ok: false; error: string }>;
  release(request: LegacyFoodRequest, token: string, success: boolean, result: LegacyFoodPayload | null): Promise<void>;
  reserveSearch(request: LegacyFoodRequest, token: string): Promise<{ ok: true; replay: boolean } | { ok: false; error: string }>;
  measureSearch(request: LegacyFoodRequest, token: string, count: number): Promise<void>;
}
export type LegacyFoodDependencies = {
  authenticate(authorization: string): Promise<{ id: string } | null>;
  store(userId: string): LegacyFoodStore;
  configured(): boolean;
  searchEnabled(): boolean;
  interpret(text: string, signal: AbortSignal): Promise<unknown>;
  resolve(query: FoodQuery, signal: AbortSignal, userId: string): Promise<NutritionResult>;
  ground(query: FoodQuery, signal: AbortSignal, onUsage: (usage: GeminiUsage) => void): Promise<GroundedAnswer>;
  newToken?: () => string;
};
export const LEGACY_FOOD_HEADERS = {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
};
const REFRESH_MESSAGE = "Live Search answers are not stored. Start a new lookup to refresh the answer, or enter the package label manually.";
function json(payload: LegacyFoodPayload, status = 200): Response { return new Response(JSON.stringify(payload), { status, headers: LEGACY_FOOD_HEADERS }); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRequest(value: unknown): LegacyFoodRequest {
  const body = record(value);
  if (Object.keys(body).some(key => !["requestId", "query", "mode"].includes(key)) || typeof body.requestId !== "string" || !UUID.test(body.requestId) || typeof body.query !== "string" || !body.query.trim() || body.query.length > 1000 || /[\u0000-\u001f\u007f]/u.test(body.query)) throw new Error("bad_request");
  const mode = body.mode ?? "auto";
  if (mode !== "auto" && mode !== "fill" && mode !== "web") throw new Error("bad_request");
  return { requestId: body.requestId, query: body.query.trim(), mode };
}
function toLegacyFood(food: ReviewedFood): LegacyFood | null {
  if (!["usda", "openfoodfacts", "my_food"].includes(food.source) || typeof food.grams !== "number" || !Number.isFinite(food.grams) || food.grams <= 0 || food.grams > 10_000 || [food.calories, food.protein, food.carbs, food.fat].some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000)) return null;
  const evidence = food.evidence;
  if (!evidence || !evidence.sourceId || !evidence.license || (food.source === "my_food" ? evidence.record !== "user_owned" : evidence.record !== "independent" || !isSafeGroundingUrl(evidence.url))) return null;
  if (!food.query.portion || JSON.stringify(food.query.portion) !== JSON.stringify(food.portion) || (food.portion.unit === "g" && food.portion.amount !== food.grams)) return null;
  return {
    name: food.name, serving_label: food.servingLabel, serving_grams: food.grams, kcal: food.calories, protein: food.protein, carbs: food.carbs, fat: food.fat,
    confidence: "high", source: food.source as LegacyFood["source"], source_detail: evidence.title,
    evidence, requested_portion: food.portion, requested_query: food.query,
    ...(food.query.brand ? { brand: food.query.brand } : {}),
  };
}
function validLiveAnswer(value: GroundedAnswer): boolean {
  return typeof value.text === "string" && !!value.text.trim() && value.text.length <= 20_000 && Number.isSafeInteger(value.searchQueryCount) && value.searchQueryCount > 0 && value.searchQueryCount <= 32
    && Array.isArray(value.citations) && value.citations.length > 0 && value.citations.length <= 100
    && value.citations.every(c => isSafeGroundingUrl(c.url) && typeof c.title === "string" && !!c.title.trim() && Number.isSafeInteger(c.startIndex) && Number.isSafeInteger(c.endIndex) && c.startIndex >= 0 && c.startIndex < c.endIndex && c.endIndex <= value.text.length)
    && Array.isArray(value.searchSuggestionsHtml) && value.searchSuggestionsHtml.length > 0 && value.searchSuggestionsHtml.length <= 5 && value.searchSuggestionsHtml.every(validateSuggestionsHtml);
}
function quotaError(error: string): LegacyFoodError { return ["rate_limited", "over_free_quota", "over_pro_cap", "busy", "conflict"].includes(error) ? error as LegacyFoodError : "ai_unavailable"; }

/** Lookup only: neither an ordinary request nor a Search answer writes a food diary. */
export async function handleLegacyFoodRequest(req: Request, deps: LegacyFoodDependencies): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: LEGACY_FOOD_HEADERS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.length > 8192 || !/^Bearer \S+$/i.test(authorization)) return json({ error: "unauthorized" }, 401);
  let user: { id: string } | null;
  try { user = await deps.authenticate(authorization); } catch { return json({ error: "unauthorized" }, 401); }
  if (!user) return json({ error: "unauthorized" }, 401);
  let request: LegacyFoodRequest;
  try { request = parseRequest(await readBoundedRequestJson(req)); } catch { return json({ error: "bad_request" }, 400); }
  if (!deps.configured()) return json({ error: "not_configured" }, 503);
  const token = (deps.newToken ?? (() => crypto.randomUUID()))();
  const store = deps.store(user.id); let reserved = false;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(55_000)]);
  try {
    const fingerprint = await requestFingerprint({ endpoint: "ai-food", query: request.query, mode: request.mode });
    const reservation = await store.reserve(request, fingerprint, token);
    if (!reservation.ok) return json({ error: quotaError(reservation.error) });
    if (reservation.replay) return json(reservation.result);
    reserved = true;
    const finish = async (result: LegacyFoodPayload, success: boolean, persisted: LegacyFoodPayload | null = null): Promise<Response> => {
      await store.release(request, token, success, persisted); reserved = false; return json(result);
    };
    const intent = retainFoodList(parseIntent(await deps.interpret(request.query, signal)),request.query);
    if (intent.kind !== "nutrition") return await finish({ error: "needs_input", message: intent.kind === "clarify" ? intent.question : intent.kind === "multiple" ? "Look up each food separately with its portion." : "Enter one food and its portion, such as 72 g boiled egg." }, false);
    if (request.mode !== "web") {
      const resolved = await deps.resolve(intent.query, signal, user.id);
      if (resolved.kind === "found") {
        const food = toLegacyFood(resolved.food);
        if (!food) return await finish({ error: "needs_input", message: "This record does not verify the serving weight and complete nutrition. Enter the package label or provide a weight in grams." }, false);
        const result = { food, alternatives: [] };
        return await finish(result, true, result);
      }
      if (resolved.kind === "clarification" || !deps.searchEnabled()) return await finish({ error: "needs_input", message: resolved.message }, false);
    } else if (!deps.searchEnabled()) return await finish({ error: "needs_input", message: "Live Search is unavailable. Try a database lookup or enter the package label manually." }, false);
    const search = await store.reserveSearch(request, token);
    // A consumed Search reservation is never reusable, even when the lookup credit was refunded.
    if (!search.ok || search.replay !== false) return await finish({ error: search.ok ? "search_unavailable" : quotaError(search.error) }, false);
    let searchQueries = 0; let answer: GroundedAnswer;
    try {
      answer = await deps.ground(intent.query, signal, usage => { searchQueries = usage.searchQueries; });
      if (!validLiveAnswer(answer)) throw new Error("invalid_response");
      searchQueries = answer.searchQueryCount;
    } finally {
      // Actual queries remain accounted for even if citation/widget validation rejects the answer.
      await store.measureSearch(request, token, searchQueries);
    }
    return await finish({ error: "answer_only", answer, message: "This live Search answer cannot create a food entry. Verify a matching nutrition record or enter the package label manually." }, true, { error: "needs_input", message: REFRESH_MESSAGE });
  } catch {
    if (reserved) {
      try { await store.release(request, token, false, null); }
      catch { console.error("ai_food_lookup_release_failed"); }
    }
    return json({ error: "ai_unavailable" }, 502);
  }
}
