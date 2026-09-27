import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "./supabase";
import { buildAiFoodReview, requestAiFood, type AiFood } from "./aiFood";

// vitest hoists vi.mock above the imports above, so the mock still applies.
vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: vi.fn() }, auth: { getSession: vi.fn() } },
}));

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;
const getSession = vi.mocked(supabase.auth.getSession);
const food: AiFood = { name: "Egg", serving_label: "72 g", serving_grams: 72, kcal: 111.6, protein: 9.06, carbs: 0.8, fat: 7.64, source: "usda", confidence: "high" };
const answer = { text: "Check the package label.", citations: [{ title: "Manufacturer", url: "https://www.rebisco.com.ph/", startIndex: 0, endIndex: 24 }], searchSuggestionsHtml: ['<a href="https://www.google.com/search?q=product">Product nutrition</a>'], searchQueryCount: 1 };

describe("editable matched food review", () => {
  const original = { ...food, requested_portion: { amount: 72, unit: "g" as const }, source_detail: "USDA record", notes: "Source serving", evidence: { url: "https://fdc.nal.usda.gov/", title: "USDA", identity: "Boiled egg", retrievedAt: "2026-09-26T00:00:00Z", excerpt: "Label", basis: { grams: 100, unit: "g" as const, count: null, milliliters: null, nutrients: { calories: 155, protein: 12.58, carbs: 1.12, fat: 10.61 } } } };

  it("keeps an unchanged review and its original requested portion", () => {
    expect(buildAiFoodReview(original, { name: original.name, kcal: original.kcal, protein: original.protein, carbs: original.carbs, fat: original.fat })).toBe(original);
  });

  it.each([{ name: "My egg" }, { kcal: 130 }, { protein: 12 }])("marks changed fields as user-entered without source claims: %j", (change) => {
    const edited = buildAiFoodReview(original, { name: original.name, kcal: original.kcal, protein: original.protein, carbs: original.carbs, fat: original.fat, ...change });
    expect(edited).toMatchObject({ source: "my_food", confidence: "low", user_entered: true, serving_label: "72 g", serving_grams: 72, requested_portion: { amount: 72, unit: "g" } });
    expect(edited.evidence).toBeUndefined();
    expect(edited.source_detail).toBeUndefined();
    expect(edited.requested_query).toBeUndefined();
  });
});

describe("requestAiFood", () => {
  beforeEach(() => {
    invoke.mockReset();
    getSession.mockResolvedValue({ data: { session: { user: { id: "account-a" }, access_token: "account-a-token" } }, error: null } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
  });

  it("returns the food on success", async () => {
    invoke.mockResolvedValue({ data: { food }, error: null });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: true, food, alternatives: [] });
  });

  it("returns alternatives from the response, defaulting to []", async () => {
    const alt = { ...food, name: "Other matched egg record" };
    invoke.mockResolvedValueOnce({
      data: { food, alternatives: [alt] },
      error: null,
    });
    const r = await requestAiFood("60g white rice");
    expect(r).toEqual({ ok: true, food, alternatives: [alt] });

    invoke.mockResolvedValueOnce({ data: { food }, error: null });
    const r2 = await requestAiFood("60g white rice");
    expect(r2.ok && r2.alternatives).toEqual([]);
  });

  it("sends mode web to the edge function", async () => {
    invoke.mockResolvedValueOnce({ data: { food }, error: null });
    await requestAiFood("tender juicy cheesedog", "web");
    expect(invoke).toHaveBeenCalledWith("ai-food", {
      body: { query: "tender juicy cheesedog", mode: "web", requestId: expect.any(String) },
      headers: { Authorization: "Bearer account-a-token" },
    });
  });

  it("returns a live answer separately from loggable food", async () => {
    invoke.mockResolvedValueOnce({ data: { error: "answer_only", answer, message: "Use a package label to log this food." }, error: null });
    expect(await requestAiFood("unverified product")).toEqual({ ok: false, reason: "answer_only", answer, message: "Use a package label to log this food." });
  });

  it("keeps a clarification without inventing nutrition defaults", async () => {
    invoke.mockResolvedValueOnce({ data: { error: "needs_input", message: "Which flavor and package size?" }, error: null });
    expect(await requestAiFood("Fudgee Barr")).toEqual({ ok: false, reason: "needs_input", message: "Which flavor and package size?" });
  });

  it.each([
    { ...food, source: "web" },
    { ...food, source: "ai_estimate" },
    { ...food, kcal: Number.NaN },
    { ...food, serving_grams: null },
    { ...food, fat: -1 },
    { ...food, notes: { unsafe: "not text" } },
    { ...food, evidence: {} },
    { ...food, requested_portion: { amount: -1, unit: "g" } },
    { name: "Egg", kcal: 72 },
  ])("rejects malformed or Google-only food: %j", async (invalid) => {
    invoke.mockResolvedValueOnce({ data: { food: invalid }, error: null });
    expect(await requestAiFood("egg")).toEqual({ ok: false, reason: "error" });
  });

  it("rejects a live answer whose suggestion markup is unsafe", async () => {
    invoke.mockResolvedValueOnce({ data: { error: "answer_only", answer: { ...answer, searchSuggestionsHtml: ['<script>alert(1)</script>'] }, message: "Live answer" }, error: null });
    expect(await requestAiFood("product")).toEqual({ ok: false, reason: "error" });
  });

  it("drops an old account's response after an account switch", async () => {
    invoke.mockImplementationOnce(async () => {
      getSession.mockResolvedValue({ data: { session: { user: { id: "account-b" }, access_token: "account-b-token" } }, error: null } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
      return { data: { food }, error: null };
    });
    expect(await requestAiFood("egg")).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("reuses an explicitly provided request ID after a lost response", async () => {
    const requestId = "11111111-1111-4111-8111-111111111111";
    invoke.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    invoke.mockResolvedValueOnce({ data: { food }, error: null });
    await requestAiFood("egg", "auto", requestId);
    await requestAiFood("egg", "auto", requestId);
    expect(invoke.mock.calls[0][1].body.requestId).toBe(requestId);
    expect(invoke.mock.calls[1][1].body.requestId).toBe(requestId);
  });

  it("maps a quota error carried in the body", async () => {
    invoke.mockResolvedValue({ data: { error: "over_free_quota" }, error: null });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: false, reason: "over_free_quota" });
  });

  it("maps an AI availability error carried in the body", async () => {
    invoke.mockResolvedValue({ data: { error: "ai_unavailable" }, error: null });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: false, reason: "ai_unavailable" });
  });

  it("maps an AI availability error carried by an HTTP function error", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: {
          json: async () => ({ error: "ai_unavailable" }),
        },
      },
    });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: false, reason: "ai_unavailable" });
  });

  it("returns error when the function rejects", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: false, reason: "error" });
  });

  it("returns error when invoke throws", async () => {
    invoke.mockImplementationOnce(async () => {
      throw new Error("network");
    });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: false, reason: "error" });
  });
});
