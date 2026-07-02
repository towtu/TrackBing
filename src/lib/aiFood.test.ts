import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabase } from "./supabase";
import { requestAiFood } from "./aiFood";

// vitest hoists vi.mock above the imports above, so the mock still applies.
vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

describe("requestAiFood", () => {
  beforeEach(() => invoke.mockReset());

  it("returns the food on success", async () => {
    invoke.mockResolvedValue({ data: { food: { name: "Egg", kcal: 72 } }, error: null });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: true, food: { name: "Egg", kcal: 72 }, alternatives: [] });
  });

  it("returns alternatives from the response, defaulting to []", async () => {
    const food = { name: "Rice, white, cooked", kcal: 130 };
    const alt = { name: "Rice, white, raw", kcal: 365 };
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
    invoke.mockResolvedValueOnce({ data: { food: { name: "Cheesedog" } }, error: null });
    await requestAiFood("tender juicy cheesedog", "web");
    expect(invoke).toHaveBeenCalledWith("ai-food", {
      body: { query: "tender juicy cheesedog", mode: "web" },
    });
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
