import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "./supabase";
import {FunctionsFetchError} from '@supabase/supabase-js';
import { createLabelReader } from "./labelReader";
vi.mock(
  "./supabase",
  () => ({
    supabase: { auth: { getSession: vi.fn() }, functions: { invoke: vi.fn() } },
  }),
);
const session = vi.mocked(supabase.auth.getSession),
  invoke = vi.mocked(supabase.functions.invoke);
const image = "data:image/jpeg;base64," +
  btoa(
    String.fromCharCode(...[
      255,
      216,
      255,
      192,
      0,
      17,
      8,
      0,
      20,
      0,
      30,
      3,
      1,
      17,
      0,
      2,
      17,
      0,
      3,
      17,
      0,
      255,
      217,
    ]),
  );
const label = {
  foodName: "TEST label",
  basis: "per_100g",
  servingGrams: null,
  servingDescription: null,
  energy: 100,
  energyUnit: "kcal",
  protein: null,
  carbs: 10,
  fat: 2,
  warnings: [],
};
function user(id: string) {
  session.mockResolvedValue(
    {
      data: { session: { user: { id }, access_token: "test-token" } },
      error: null,
    } as Awaited<ReturnType<typeof supabase.auth.getSession>>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  user("owner");
});
describe("Account-scoped label reader", () => {
  it('keeps response-loss recovery when the SDK resolves a fetch failure rather than rejecting',async()=>{
    invoke.mockResolvedValueOnce({data:null,error:new FunctionsFetchError(new Error('network failed'))});
    const reader=createLabelReader('owner');expect(await reader.read('original-id',image)).toEqual({ok:false,error:'offline'});
    invoke.mockResolvedValueOnce({data:{ok:true,label},error:null});expect(await reader.read('original-id',image)).toEqual({ok:true,label});
    expect(invoke.mock.calls.map(([,o])=>(o?.body as {requestId:string}).requestId)).toEqual(['original-id','original-id']);reader.dispose();
  });
  it("retains a caller request ID for response-loss retries and sends only one photo", async () => {
    invoke.mockResolvedValue({ data: { ok: true, label }, error: null });
    const reader = createLabelReader("owner");
    expect(await reader.read("same-id", image)).toEqual({ ok: true, label });
    expect(await reader.read("same-id", image)).toEqual({ ok: true, label });
    expect(
      invoke.mock.calls.every(([name, options]) =>
        name === "ai-label" &&
        options?.headers?.Authorization === "Bearer test-token" &&
        (options.body as { requestId: string }).requestId === "same-id"
      ),
    ).toBe(true);
    reader.dispose();
  });
  it("does not invoke with another signed-in account", async () => {
    user("other");
    expect(await createLabelReader("owner").read("id", image)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("suppresses a response if the account switches during reading", async () => {
    let finish: (v: { data: unknown; error: null }) => void = () => {};
    invoke.mockImplementation(() =>
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const reader = createLabelReader("owner"), work = reader.read("id", image);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    user("other");
    finish({ data: { ok: true, label }, error: null });
    expect(await work).toBeNull();
    reader.dispose();
  });
  it("aborts a deferred upload and suppresses late results after closing", async () => {
    let finish: (v: { data: unknown; error: null }) => void = () => {};
    invoke.mockImplementation(() =>
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const reader = createLabelReader("owner"), work = reader.read("id", image);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    reader.dispose();
    expect(invoke.mock.calls[0][1]?.signal?.aborted).toBe(true);
    finish({ data: { ok: true, label }, error: null });
    expect(await work).toBeNull();
  });
  it("returns a safe provider failure and treats malformed transcription as a safe error", async () => {
    invoke.mockResolvedValueOnce({
      data: { ok: false, error: "provider_unavailable", detail: "SECRET" },
      error: null,
    });
    const reader = createLabelReader("owner");
    expect(await reader.read("id", image)).toEqual({
      ok: false,
      error: "provider_unavailable",
    });
    invoke.mockResolvedValueOnce({
      data: { ok: true, label: { energy: 123 } },
      error: null,
    });
    expect(await reader.read("new-id", image)).toEqual({
      ok: false,
      error: "error",
    });
    reader.dispose();
  });
});
