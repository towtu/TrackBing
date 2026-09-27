import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BeeSnapshot, PendingFood } from "../../supabase/functions/_shared/beeTypes";
import { supabase } from "./supabase";
import {
  createBeeClient,
  createBeeRequest,
  createBeeRetryRequest,
  getBeeSourceUrl,
  isCurrentBeeReview,
  resolveBeeTimeZone,
} from "./beeChat";

vi.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}));

const invoke = vi.mocked(supabase.functions.invoke);
const getSession = vi.mocked(supabase.auth.getSession);
const snapshot: BeeSnapshot = {
  thread: { id: "thread-a", version: 4 },
  messages: [],
  memories: [],
  profile: {},
  pending: null,
};
const servingDraft: PendingFood = {
  id: "review-a", thread_id: "thread-a", review_version: 1, status: "pending",
  local_date: "2026-09-26", time_zone: "Asia/Manila", expires_at: "2099-09-26T08:00:00Z",
  food: {
    name: "My saved serving", query: { name: "My saved serving", preparation: null, brand: null, variant: null, packageGrams: null, market: null, portion: { amount: 1, unit: "serving" } },
    portion: { amount: 1, unit: "serving" }, grams: null, servingLabel: "1 serving",
    calories: 120, protein: 3, carbs: 18, fat: 4, source: "my_food",
    evidence: { url: "", title: "Your saved food", identity: "My saved serving", retrievedAt: "2026-09-26T08:00:00Z", excerpt: "User-saved label", record: "user_owned",
      basis: { grams: null, nutrients: { calories: 120, protein: 3, carbs: 18, fat: 4 }, unit: "serving", count: 1, milliliters: null } },
  },
};

function setUser(id: string) {
  getSession.mockResolvedValue({
    data: { session: { user: { id }, access_token: `token-${id}` } },
    error: null,
  } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
}

describe("Bee account client", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setUser("account-a");
  });

  it.each(["new_thread", "confirm"] as const)(
    "retries %s with the identical request ID and never automatically replays it",
    async (kind) => {
      const command = kind === "confirm"
        ? { kind, actionId: "review-a", reviewVersion: 2 }
        : { kind };
      const request = createBeeRequest(command, snapshot, "Asia/Manila");
      const client = createBeeClient("account-a");
      invoke.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      invoke.mockResolvedValueOnce({ data: { ok: true, snapshot }, error: null });

      expect(await client.send(request)).toEqual({ ok: false, error: "offline" });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(await client.send(request)).toEqual({ ok: true, snapshot });
      expect(invoke.mock.calls[0]?.[1]?.body).toEqual(request);
      expect(invoke.mock.calls[1]?.[1]?.body).toEqual(request);
      expect(request.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(invoke.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer token-account-a" });
      client.dispose();
    },
  );

  it("retains expected version and the reviewed action on a typed confirmation", () => {
    const pending = { id: "review-a", review_version: 2, status: "pending" } as PendingFood;
    const request = createBeeRequest({ kind: "message", text: "yes" }, { ...snapshot, pending }, "UTC");
    expect(request).toMatchObject({
      threadId: "thread-a",
      expectedVersion: 4,
      command: { kind: "message", text: "yes", actionId: "review-a", reviewVersion: 2 },
    });
    pending.review_version = 3;
    expect(request.command).toMatchObject({ reviewVersion: 2 });
  });

  it("maps structured HTTP failures without exposing raw provider details", async () => {
    invoke.mockResolvedValueOnce({
      data: null,
      error: { context: { json: async () => ({ ok: false, error: "over_free_quota", detail: "private" }) } },
    });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toEqual({ ok: false, error: "over_free_quota" });
    client.dispose();
  });

  it("rejects malformed success envelopes", async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: { thread: {}, messages: null } }, error: null });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toEqual({ ok: false, error: "error" });
    client.dispose();
  });

  it("accepts an ephemeral grounded answer without adding a food review", async () => {
    const liveAnswer = {
      text: "The exact nutrition label could not be verified.",
      citations: [{ title: "Product page", url: "https://example.com/product", startIndex: 0, endIndex: 45 }],
      searchSuggestionsHtml: ['<div><a href="https://www.google.com/search?q=product">Product nutrition</a></div>'],
      searchQueryCount: 1,
    };
    invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: { ...snapshot, liveAnswer } }, error: null });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "message", text: "Product calories?" })))
      .toEqual({ ok: true, snapshot: { ...snapshot, liveAnswer } });
    client.dispose();
  });

  it.each([
    { citations: [{ title: "Unsafe", url: "javascript:alert(1)", startIndex: 0, endIndex: 1 }] },
    { citations: [{ title: "Private", url: "http://127.0.0.1/product", startIndex: 0, endIndex: 1 }] },
    { citations: [{ title: "Invalid range", url: "https://example.com/product", startIndex: -1, endIndex: 99 }] },
    { searchSuggestionsHtml: ['<div onclick="alert(1)">Unsafe</div>'] },
    { searchSuggestionsHtml: ['<script>alert(1)</script>'] },
    { searchQueryCount: -1 },
  ])("rejects unsafe live search payloads: %j", async (invalid) => {
    const liveAnswer = {
      text: "Live answer",
      citations: [{ title: "Product", url: "https://example.com/product", startIndex: 0, endIndex: 11 }],
      searchSuggestionsHtml: ['<a href="https://www.google.com/search?q=product">Product nutrition</a>'],
      searchQueryCount: 1,
      ...invalid,
    };
    invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: { ...snapshot, liveAnswer } }, error: null });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toEqual({ ok: false, error: "error" });
    client.dispose();
  });

  it("restores explicitly saved usual preparation preferences", async () => {
    const restored = { ...snapshot, memories: [{ key: "usual_preparation", value: "I measure rice cooked", updated_at: "2026-09-26T08:00:00Z" }] };
    invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: restored }, error: null });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toEqual({ ok: true, snapshot: restored });
    client.dispose();
  });

  it("keeps a permitted native serving when its gram weight is unknown", async () => {
    const current = { ...snapshot, pending: servingDraft };
    invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: current }, error: null });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toEqual({ ok: true, snapshot: current });
    client.dispose();
  });

  it.each(["web", "ai_estimate"] as const)("does not expose Add for a %s-only draft", async (source) => {
    const pending = { ...servingDraft, food: { ...servingDraft.food, source } };
    invoke.mockResolvedValueOnce({ data: { ok: true, snapshot: { ...snapshot, pending } }, error: null });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toEqual({ ok: false, error: "error" });
    client.dispose();
  });

  it("drops a response arriving after an account switch", async () => {
    invoke.mockImplementationOnce(async () => {
      setUser("account-b");
      return { data: { ok: true, snapshot }, error: null };
    });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toBeNull();
    client.dispose();
  });

  it("also discards a failed request after switching accounts", async () => {
    invoke.mockImplementationOnce(async () => {
      setUser("account-b");
      throw new TypeError("Failed to fetch");
    });
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toBeNull();
    client.dispose();
  });

  it("does not dispatch with a different account's token", async () => {
    setUser("account-b");
    const client = createBeeClient("account-a");
    expect(await client.send(createBeeRequest({ kind: "load" }))).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    client.dispose();
  });

  it("aborts and ignores work after its component unmounts", async () => {
    const client = createBeeClient("account-a");
    invoke.mockImplementationOnce(async (_name, options) => {
      client.dispose();
      expect(options?.signal?.aborted).toBe(true);
      return { data: { ok: true, snapshot }, error: null };
    });
    expect(await client.send(createBeeRequest({ kind: "load" }))).toBeNull();
  });
});

describe("Bee review and environment boundaries", () => {
  it("keeps the identical request for an uncertain response", () => {
    const request = createBeeRequest({ kind: "confirm", actionId: servingDraft.id, reviewVersion: 1 }, snapshot);
    expect(createBeeRetryRequest(request, "offline")).toBe(request);
    expect(createBeeRetryRequest(request, "busy")).toBe(request);
  });

  it("starts a fresh provider retry only after refreshing the conversation version", () => {
    const request = createBeeRequest({ kind: "message", text: "72 g boiled egg calories?" }, snapshot);
    expect(createBeeRetryRequest(request, "provider_unavailable")).toBeNull();
    const retry = createBeeRetryRequest(request, "provider_unavailable", { ...snapshot, thread: { ...snapshot.thread, version: 5 } });
    expect(retry?.requestId).not.toBe(request.requestId);
    expect(retry?.expectedVersion).toBe(5);
    expect(retry?.command).toEqual(request.command);
  });

  it("does not retry a completed save against a changed or consumed review", () => {
    const request = createBeeRequest({ kind: "confirm", actionId: servingDraft.id, reviewVersion: 1 }, snapshot);
    expect(createBeeRetryRequest(request, "save_failed", snapshot)).toBeNull();
    expect(createBeeRetryRequest(request, "save_failed", { ...snapshot, pending: { ...servingDraft, review_version: 2 } })).toBeNull();
    const retry = createBeeRetryRequest(request, "save_failed", { ...snapshot, pending: servingDraft }, "Asia/Manila");
    expect(retry?.requestId).not.toBe(request.requestId);
    expect(retry?.command).toEqual(request.command);
  });

  it("uses the current timezone for a fresh lookup and requires a new review after timezone changes", () => {
    const request = createBeeRequest({ kind: "message", text: "egg calories" }, snapshot, "Asia/Manila");
    const retry = createBeeRetryRequest(request, "provider_unavailable", snapshot, "America/New_York");
    expect(retry?.timeZone).toBe("America/New_York");
    const confirm = createBeeRequest({ kind: "confirm", actionId: servingDraft.id, reviewVersion: 1 }, snapshot, "Asia/Manila");
    expect(createBeeRetryRequest(confirm, "save_failed", { ...snapshot, pending: servingDraft }, "America/New_York")).toBeNull();
    expect(createBeeRetryRequest(confirm, "offline", undefined, "America/New_York")).toBe(confirm);
  });

  it("enables only the current, unexpired review", () => {
    const draft = { id: "review-a", review_version: 2, status: "pending", expires_at: "2026-09-15T12:00:00Z" } as PendingFood;
    const current = { ...snapshot, pending: draft };
    const beforeExpiry = Date.parse("2026-09-15T11:00:00Z");
    expect(isCurrentBeeReview(draft, current, beforeExpiry)).toBe(true);
    expect(isCurrentBeeReview({ ...draft, review_version: 1 }, current, beforeExpiry)).toBe(false);
    expect(isCurrentBeeReview(draft, { ...current, pending: null }, beforeExpiry)).toBe(false);
    expect(isCurrentBeeReview(draft, current, Date.parse(draft.expires_at))).toBe(false);
    expect(isCurrentBeeReview(draft, { ...current, pending: { ...draft, status: "confirmed" } }, beforeExpiry)).toBe(false);
  });

  it("uses a validated device timezone with a Philippine-only locale fallback", () => {
    expect(resolveBeeTimeZone({ timeZone: "America/New_York", locale: "en-PH" })).toBe("America/New_York");
    expect(resolveBeeTimeZone({ timeZone: "invalid", locale: "en-PH" })).toBe("Asia/Manila");
    expect(resolveBeeTimeZone({ locale: "fil" })).toBe("Asia/Manila");
    expect(resolveBeeTimeZone({ locale: "en-US" })).toBe("UTC");
  });

  it("allows ordinary source links and rejects executable or credential URLs", () => {
    expect(getBeeSourceUrl("https://example.com/nutrition?food=rice")).toBe("https://example.com/nutrition?food=rice");
    expect(getBeeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(getBeeSourceUrl("https://user:password@example.com/nutrition")).toBeNull();
    expect(getBeeSourceUrl("")).toBeNull();
    expect(getBeeSourceUrl("http://localhost/nutrition")).toBeNull();
    expect(getBeeSourceUrl("http://10.0.0.1/nutrition")).toBeNull();
  });
});
