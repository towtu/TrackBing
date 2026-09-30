import { describe, expect, it, vi } from "vitest";
import { handleLegacyFoodRequest, type LegacyFoodDependencies, type LegacyFoodStore, type LegacyFoodPayload } from "./beeLegacyFood.ts";
import type { ReviewedFood, FoodQuery, GroundedAnswer } from "./beeTypes.ts";

const requestId = "12345678-1234-4234-8234-123456789abc";
const token = "22345678-1234-4234-8234-123456789abc";
const query: FoodQuery = { name: "egg", preparation: "boiled", brand: null, variant: null, packageGrams: null, market: null, portion: { amount: 72, unit: "g" } };
const food: ReviewedFood = {
  name: "Egg, whole, cooked, hard-boiled", query, portion: { amount: 72, unit: "g" }, grams: 72, servingLabel: "72 g", source: "usda", calories: 112, protein: 9.1, carbs: .8, fat: 7.6,
  evidence: { title: "USDA egg", identity: "Egg, whole, cooked, hard-boiled", url: "https://fdc.nal.usda.gov/food-details/123/nutrients", retrievedAt: "2026-09-26T00:00:00Z", sourceId: "123", record: "independent", license: "CC0-1.0", attribution: "USDA FoodData Central", excerpt: "Independently licensed record", basis: { grams: 100, unit: "g", count: null, milliliters: null, nutrients: { calories: 155, protein: 12.6, carbs: 1.1, fat: 10.6 } } },
};
const answer: GroundedAnswer = { text: "The exact nutrition panel is unverified.", citations: [{ title: "Source", url: "https://example.com/panel", startIndex: 0, endIndex: 40 }], searchSuggestionsHtml: ['<a href="https://www.google.com/search?q=egg">egg</a>'], searchQueryCount: 2 };
function setup() {
  const store: LegacyFoodStore = {
    reserve: vi.fn().mockResolvedValue({ ok: true, replay: false }), release: vi.fn().mockResolvedValue(undefined),
    reserveSearch: vi.fn().mockResolvedValue({ ok: true, replay: false }), measureSearch: vi.fn().mockResolvedValue(undefined),
  };
  const deps: LegacyFoodDependencies = {
    authenticate: vi.fn().mockResolvedValue({ id: "owner" }), store: vi.fn().mockReturnValue(store), configured: () => true, searchEnabled: () => true,
    interpret: vi.fn().mockResolvedValue({ kind: "nutrition", query }), resolve: vi.fn().mockResolvedValue({ kind: "found", food }),
    ground: vi.fn().mockImplementation(async (_q, _signal, onUsage) => { onUsage({ inputTokens: 10, outputTokens: 12, searchQueries: 2 }); return answer; }), newToken: () => token,
  };
  return { store, deps };
}
const req = (body: unknown = { requestId, query: "72 g boiled egg", mode: "auto" }, authorization = "Bearer valid-jwt") => new Request("https://trackbing.example/ai-food", { method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body) });
const payload = async (response: Response) => await response.json() as LegacyFoodPayload;

describe("Legacy food migration", () => {
  it("returns original portion and licensed evidence in the existing food contract", async () => {
    const { deps, store } = setup(); const response = await handleLegacyFoodRequest(req(), deps);
    expect(await payload(response)).toMatchObject({ food: { name: food.name, serving_grams: 72, serving_label: "72 g", kcal: 112, source: "usda", confidence: "high", evidence: food.evidence, requested_portion: query.portion, requested_query: query }, alternatives: [] });
    expect(deps.ground).not.toHaveBeenCalled(); expect(store.reserveSearch).not.toHaveBeenCalled();
    expect(store.release).toHaveBeenCalledWith(expect.objectContaining({ requestId }), token, true, expect.objectContaining({ food: expect.objectContaining({ serving_grams: 72 }) }));
    expect(deps.store).toHaveBeenCalledWith("owner");
  });
  it.each([null, 0, NaN])("does not fabricate a serving weight for %s", async (grams) => {
    const { deps, store } = setup(); vi.mocked(deps.resolve).mockResolvedValue({ kind: "found", food: { ...food, grams } as ReviewedFood });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toMatchObject({ error: "needs_input" });
    expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
    expect(deps.ground).not.toHaveBeenCalled();
  });
  it.each(["web", "ai_estimate"])("rejects legacy generated source %s", async (source) => {
    const { deps, store } = setup(); vi.mocked(deps.resolve).mockResolvedValue({ kind: "found", food: { ...food, source } as ReviewedFood });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toMatchObject({ error: "needs_input" });
    expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
  });
  it("returns a transient Search answer on an independent miss, never a food", async () => {
    const { deps, store } = setup(); vi.mocked(deps.resolve).mockResolvedValue({ kind: "unavailable", message: "No independent record" });
    const body = await payload(await handleLegacyFoodRequest(req(), deps));
    expect(body).toMatchObject({ error: "answer_only", answer }); expect(body).not.toHaveProperty("food");
    expect(store.reserveSearch).toHaveBeenCalledWith(expect.anything(), token); expect(store.measureSearch).toHaveBeenCalledWith(expect.anything(), token, 2);
    expect(store.release).toHaveBeenCalledWith(expect.anything(), token, true, { error: "needs_input", message: expect.any(String) });
    expect(JSON.stringify(vi.mocked(store.release).mock.calls)).not.toContain(answer.text);
    expect(JSON.stringify(vi.mocked(store.release).mock.calls)).not.toContain("example.com/panel");
  });
  it("skips independent lookup for explicit web mode", async () => {
    const { deps } = setup();
    expect(await payload(await handleLegacyFoodRequest(req({ requestId, query: "72 g boiled egg", mode: "web" }), deps))).toMatchObject({ error: "answer_only" });
    expect(deps.resolve).not.toHaveBeenCalled(); expect(deps.ground).toHaveBeenCalledOnce();
  });
  it("asks for missing identity and serving details before searching", async () => {
    const { deps, store } = setup(); vi.mocked(deps.interpret).mockResolvedValue({ kind: "clarify", question: "Which flavor and bar size?", query: null });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toEqual({ error: "needs_input", message: "Which flavor and bar size?" });
    expect(deps.resolve).not.toHaveBeenCalled(); expect(deps.ground).not.toHaveBeenCalled(); expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
  });
  it("does not spend lookup credit on resolver clarification", async () => {
    const { deps, store } = setup(); vi.mocked(deps.resolve).mockResolvedValue({ kind: "clarification", message: "Which exact variant?" });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toEqual({ error: "needs_input", message: "Which exact variant?" });
    expect(deps.ground).not.toHaveBeenCalled(); expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
  });
  it("keeps Search disabled when flag is off", async () => {
    const { deps, store } = setup(); deps.searchEnabled = () => false; vi.mocked(deps.resolve).mockResolvedValue({ kind: "unavailable", message: "No independent record" });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toEqual({ error: "needs_input", message: "No independent record" });
    expect(deps.ground).not.toHaveBeenCalled(); expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
  });
  it("refuses Search before calling Google when the Search cap is reached", async () => {
    const { deps, store } = setup(); vi.mocked(deps.resolve).mockResolvedValue({ kind: "unavailable", message: "No independent record" }); vi.mocked(store.reserveSearch).mockResolvedValue({ ok: false, error: "rate_limited" });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toMatchObject({ error: "rate_limited" });
    expect(deps.ground).not.toHaveBeenCalled(); expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
  });
  it("refunds a failed grounded answer but accounts for actual queries", async () => {
    const { deps, store } = setup(); vi.mocked(deps.resolve).mockResolvedValue({ kind: "unavailable", message: "No independent record" });
    vi.mocked(deps.ground).mockImplementation(async (_q, _s, usage) => { usage({ inputTokens: 8, outputTokens: 4, searchQueries: 3 }); throw new Error("invalid_response"); });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toMatchObject({ error: "ai_unavailable" });
    expect(store.measureSearch).toHaveBeenCalledWith(expect.anything(), token, 3); expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
  });
  it.each(["text", "citations", "widgets"])("refunds grounded %s exceeding client display limits", async (limit) => {
    const { deps, store } = setup();
    const oversized: GroundedAnswer = {
      ...answer,
      text: limit === "text" ? "x".repeat(20_001) : answer.text,
      citations: limit === "citations" ? Array.from({ length: 101 }, () => answer.citations[0]) : answer.citations,
      searchSuggestionsHtml: limit === "widgets" ? Array.from({ length: 6 }, () => answer.searchSuggestionsHtml[0]) : answer.searchSuggestionsHtml,
    };
    vi.mocked(deps.ground).mockImplementation(async (_q, _signal, onUsage) => { onUsage({ inputTokens: 10, outputTokens: 12, searchQueries: 2 }); return oversized; });
    expect(await payload(await handleLegacyFoodRequest(req({ requestId, query: "72 g boiled egg", mode: "web" }), deps))).toEqual({ error: "ai_unavailable" });
    expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
    expect(store.release).not.toHaveBeenCalledWith(expect.anything(), token, true, expect.anything());
    expect(store.measureSearch).toHaveBeenCalledWith(expect.anything(), token, 2);
  });
  it("refuses another Search call when a failed request retries its consumed reservation", async () => {
    const { deps, store } = setup();
    vi.mocked(deps.resolve).mockResolvedValue({ kind: "unavailable", message: "No independent record" });
    vi.mocked(store.reserveSearch)
      .mockResolvedValueOnce({ ok: true, replay: false })
      .mockResolvedValueOnce({ ok: true, replay: true });
    vi.mocked(deps.ground).mockImplementation(async (_q, _s, usage) => {
      usage({ inputTokens: 8, outputTokens: 4, searchQueries: 3 });
      throw new Error("invalid_response");
    });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toMatchObject({ error: "ai_unavailable" });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toEqual({ error: "search_unavailable" });
    expect(deps.ground).toHaveBeenCalledOnce();
    expect(store.measureSearch).toHaveBeenCalledOnce();
    expect(store.measureSearch).toHaveBeenCalledWith(expect.objectContaining({ requestId }), token, 3);
    expect(store.release).toHaveBeenCalledTimes(2);
    expect(store.release).toHaveBeenLastCalledWith(expect.objectContaining({ requestId }), token, false, null);
  });
  it("refunds malformed Gemini classification", async () => {
    const { deps, store } = setup(); vi.mocked(deps.interpret).mockResolvedValue({ kind: "nutrition", query: { name: "egg", serving_grams: 100 } });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toMatchObject({ error: "ai_unavailable" }); expect(store.release).toHaveBeenCalledWith(expect.anything(), token, false, null);
  });
  it("does not claim food success if quota completion fails", async () => {
    const { deps, store } = setup(); vi.mocked(store.release).mockRejectedValue(new Error("database_error"));
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toMatchObject({ error: "ai_unavailable" });
  });
  it("returns an independently sourced replay without another model call", async () => {
    const { deps, store } = setup(); const first = await payload(await handleLegacyFoodRequest(req(), deps)); vi.mocked(deps.interpret).mockClear();
    vi.mocked(store.reserve).mockResolvedValue({ ok: true, replay: true, result: first });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toEqual(first); expect(deps.interpret).not.toHaveBeenCalled();
  });
  it("binds fingerprints to mode and complete query", async () => {
    const { deps, store } = setup(); await handleLegacyFoodRequest(req(), deps); await handleLegacyFoodRequest(req({ requestId, query: "72 g boiled egg", mode: "web" }), deps); await handleLegacyFoodRequest(req({ requestId, query: "80 g boiled egg", mode: "auto" }), deps);
    expect(new Set(vi.mocked(store.reserve).mock.calls.map(call => call[1])).size).toBe(3);
  });
  it.each([{ requestId, query: "x".repeat(1001) }, { query: "egg" }, { requestId, query: "egg", mode: "inject" }, { requestId, query: "egg", user_id: "other" }])("rejects malformed client requests before reservation", async (body) => {
    const { deps, store } = setup(); expect((await handleLegacyFoodRequest(req(body), deps)).status).toBe(400); expect(store.reserve).not.toHaveBeenCalled(); expect(deps.interpret).not.toHaveBeenCalled();
  });
  it("enforces body byte limits even without Content-Length", async () => {
    const { deps, store } = setup(); const request = new Request("https://trackbing.example", { method: "POST", headers: { authorization: "Bearer valid-jwt", "content-type": "application/json" }, body: JSON.stringify({ requestId, query: "é".repeat(5000) }) });
    expect((await handleLegacyFoodRequest(request, deps)).status).toBe(400); expect(store.reserve).not.toHaveBeenCalled();
  });
  it("rejects a failed JWT authentication before provider or storage work", async () => {
    const { deps } = setup(); vi.mocked(deps.authenticate).mockResolvedValue(null);
    expect((await handleLegacyFoodRequest(req(), deps)).status).toBe(401); expect(deps.store).not.toHaveBeenCalled(); expect(deps.interpret).not.toHaveBeenCalled();
  });
  it("rejects plain authorization text before trying auth", async () => {
    const { deps } = setup(); expect((await handleLegacyFoodRequest(req(undefined, "hello"), deps)).status).toBe(401); expect(deps.authenticate).not.toHaveBeenCalled();
  });
  it("rejects a quota denial before any provider work", async () => {
    const { deps, store } = setup(); vi.mocked(store.reserve).mockResolvedValue({ ok: false, error: "over_free_quota" });
    expect(await payload(await handleLegacyFoodRequest(req(), deps))).toEqual({ error: "over_free_quota" }); expect(deps.interpret).not.toHaveBeenCalled(); expect(store.release).not.toHaveBeenCalled();
  });
});

// Illustrative TEST DATA: source order and response compatibility, not food advice.
it('keeps curated provenance and uses medium confidence without searching',async()=>{
 const {deps,store}=setup();deps.resolve=vi.fn().mockResolvedValue({kind:'found',food:{...food,source:'trackbing_gist',evidence:{...food.evidence,url:'https://gist.githubusercontent.com/towtu/893f53e31444ad9757f5c4fb6a7edf67/raw/foods.json',license:'operator-provided'}}});
 expect(await payload(await handleLegacyFoodRequest(req(),deps))).toMatchObject({food:{source:'trackbing_gist',confidence:'medium',serving_grams:72}});
 expect(deps.ground).not.toHaveBeenCalled();expect(store.reserveSearch).not.toHaveBeenCalled();
});
it('returns an independent USDA fallback after Google without storing Google data',async()=>{
 const {deps,store}=setup(),order:string[]=[];
 deps.resolve=vi.fn().mockImplementation(async()=>{order.push('gist');return {kind:'unavailable',message:'No record'};});
 deps.ground=vi.fn().mockImplementation(async()=>{order.push('google');return answer;});
 deps.fallbackResolve=vi.fn().mockImplementation(async received=>{order.push('usda');expect(received).toEqual(query);return {kind:'found',food};});
 expect(await payload(await handleLegacyFoodRequest(req(),deps))).toMatchObject({food:{source:'usda',serving_grams:72}});
 expect(order).toEqual(['gist','google','usda']);expect(JSON.stringify(vi.mocked(store.release).mock.calls)).not.toContain(answer.text);
 expect(JSON.stringify(vi.mocked(store.release).mock.calls)).not.toContain('example.com/panel');
});
it('recovers a Google failure through genuine USDA, but explicit web stays answer only',async()=>{
 const {deps}=setup();deps.resolve=vi.fn().mockResolvedValue({kind:'unavailable',message:'No record'});
 deps.ground=vi.fn().mockRejectedValue(new Error('provider unavailable'));deps.fallbackResolve=vi.fn().mockResolvedValue({kind:'found',food});
 expect(await payload(await handleLegacyFoodRequest(req(),deps))).toMatchObject({food:{source:'usda'}});
 vi.mocked(deps.ground).mockResolvedValue(answer);vi.mocked(deps.fallbackResolve).mockClear();
 expect(await payload(await handleLegacyFoodRequest(req({requestId,query:'72 g boiled egg',mode:'web'}),deps))).toMatchObject({error:'answer_only'});
 expect(deps.fallbackResolve).not.toHaveBeenCalled();
});
