import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { supabase } from "./supabase";
import { requestAiFood } from "./aiFood";

const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

describe("requestAiFood", () => {
  beforeEach(() => invoke.mockReset());

  it("returns the food on success", async () => {
    invoke.mockResolvedValue({ data: { food: { name: "Egg", kcal: 72 } }, error: null });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: true, food: { name: "Egg", kcal: 72 } });
  });

  it("maps a quota error carried in the body", async () => {
    invoke.mockResolvedValue({ data: { error: "over_free_quota" }, error: null });
    const r = await requestAiFood("egg");
    expect(r).toEqual({ ok: false, reason: "over_free_quota" });
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
