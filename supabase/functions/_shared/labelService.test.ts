import { describe, expect, it, vi } from "vitest";
import { handleLabelRequest, type LabelStore } from "./labelService.ts";
const id = "11111111-1111-4111-8111-111111111111";
// Synthetic JPEG header and deliberately artificial nutrition, solely TEST DATA.
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
  basis: "per_100g" as const,
  servingGrams: null,
  servingDescription: null,
  energy: 100,
  energyUnit: "kcal" as const,
  protein: null,
  carbs: 10,
  fat: 2,
  warnings: [],
};
function setup() {
  const store: LabelStore = {
    policy: vi.fn().mockResolvedValue(null),
    reserve: vi.fn().mockResolvedValue({ ok: true, replay: false }),
    finish: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    authenticate: vi.fn().mockResolvedValue({ id }),
    store: vi.fn().mockReturnValue(store),
    configured: () => true,
    extract: vi.fn().mockResolvedValue(label),
  };
  return { store, deps };
}
function request(body: unknown = { requestId: id, image }) {
  return new Request("https://bee.test", {
    method: "POST",
    headers: {
      Authorization: "Bearer test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
describe("Label extraction boundary", () => {
  it("authenticates before parsing or reserving and ignores no body-supplied owner", async () => {
    const { store, deps } = setup();
    deps.authenticate.mockResolvedValue(null);
    expect((await handleLabelRequest(request(), deps)).status).toBe(401);
    expect(store.reserve).not.toHaveBeenCalled();
    deps.authenticate.mockResolvedValue({ id });
    expect(
      (await handleLabelRequest(
        request({ requestId: id, image, userId: "other" }),
        deps,
      )).status,
    ).toBe(400);
  });
  it("preserves unknown values and stores extraction only, never image bytes", async () => {
    const { store, deps } = setup();
    expect(await (await handleLabelRequest(request(), deps)).json()).toEqual({
      ok: true,
      label,
    });
    expect(store.finish).toHaveBeenCalledWith(id, expect.any(String), {
      ok: true,
      label,
    });
    expect(JSON.stringify(vi.mocked(store.finish).mock.calls)).not.toContain(
      "base64",
    );
    expect(store.record).toHaveBeenCalledTimes(2);
  });
  it("replays the completed request without another provider call", async () => {
    const { store, deps } = setup();
    vi.mocked(store.reserve).mockResolvedValue({
      ok: true,
      replay: true,
      result: { ok: true, label },
    });
    expect((await handleLabelRequest(request(), deps)).status).toBe(200);
    expect(deps.extract).not.toHaveBeenCalled();
  });
  it.each(
    ["upgrade_required", "age_restricted", "paid_data_unavailable"] as const,
  )("denies %s before paid work", async (error) => {
    const { store, deps } = setup();
    vi.mocked(store.policy).mockResolvedValue(error);
    await handleLabelRequest(request(), deps);
    expect(store.reserve).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });
  it("does not bypass a concurrent reservation or shared cap", async () => {
    const { store, deps } = setup();
    vi.mocked(store.reserve).mockResolvedValue({
      ok: false,
      error: "monthly_request_limit",
    });
    expect((await handleLabelRequest(request(), deps)).status).toBe(429);
    expect(deps.extract).not.toHaveBeenCalled();
  });
  it("fails closed for malformed output, timeout, missing key and accounting failure", async () => {
    const { store, deps } = setup();
    deps.extract.mockRejectedValue(new Error("SECRET provider timeout"));
    const response = await handleLabelRequest(request(), deps);
    expect(await response.text()).not.toContain("SECRET");
    expect(store.finish).toHaveBeenCalledWith(id, expect.any(String), null);
    deps.configured = () => false;
    expect((await handleLabelRequest(request(), deps)).status).toBe(503);
  });
});
