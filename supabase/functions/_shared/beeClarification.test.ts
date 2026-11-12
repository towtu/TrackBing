import { describe, expect, it, vi } from "vitest";
import { adaptiveTurn } from "./beeAdaptiveTurn.ts";
import { type BeeContext, deterministicTurn } from "./beeConversation.ts";
import { searchNutrition } from "./beeNutrition.ts";
import type { BeeRequest, FoodQuery } from "./beeTypes.ts";

// All nutrition below is illustrative TEST DATA, not a real Fudgee Barr label.
const query: FoodQuery = {
  name: "Fudgee Barr",
  brand: null,
  variant: null,
  preparation: null,
  market: null,
  packageGrams: null,
  portion: { amount: 1, unit: "serving" },
};
const context: BeeContext = {
  state: { awaiting: "none" },
  pending: null,
  memories: [],
  profile: { current_weight: 70, calorie_target: 2000 },
  recent: [],
};
const progress = {
  localDate: "2026-11-12",
  totals: { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 },
  weights: [],
  recentLogTimes: [],
  revision: "0",
};
const req = (text: string): BeeRequest => ({
  requestId: "TEST",
  timeZone: "Asia/Manila",
  command: { kind: "message", text },
});
const ask = (question: string, q?: FoodQuery) => ({
  reply: question,
  followUpQuestion: question,
  nextStep: "ask_one_question",
  suggestedPose: "thinking",
  ...(q ? { query: q } : {}),
});
const run = (
  text: string,
  ctx: BeeContext,
  model: ReturnType<typeof vi.fn>,
  search = vi.fn(),
) =>
  adaptiveTurn(
    req(text),
    ctx,
    progress,
    "pro",
    model,
    search,
    new Date("2026-11-12T02:00:00Z"),
  );
const chocolate = { ...query, variant: "Chocolate" };

describe("durable food clarification context", () => {
  it("recovers a structured query before publishing a food question that omitted it", async () => {
    const model = vi.fn().mockResolvedValueOnce(
      ask("Which flavor and bar size?"),
    ).mockResolvedValueOnce({ query });
    const answer = await run("fudgee bar 1 serving", context, model);
    expect(answer.state?.query).toEqual(query);
    expect(model).toHaveBeenCalledTimes(2);
    expect(answer.confirm).toBeUndefined();
  });
  it("retains the food and serving through a flavor reply when the planner omits query", async () => {
    const ctx = {
      ...context,
      state: {
        awaiting: "clarification" as const,
        query,
        question: "Which flavor and bar size?",
      },
    };
    const model = vi.fn().mockResolvedValueOnce(
      ask("How many grams is your chocolate bar?"),
    ).mockResolvedValueOnce({ query: { ...chocolate, portion: null } });
    const answer = await run("chocolate", ctx, model);
    expect(answer.state?.query).toEqual(chocolate);
    expect(model).toHaveBeenCalledTimes(2);
    const repairInput = model.mock.calls[1][1];
    expect(repairInput.currentFood).toEqual(query);
    expect(repairInput).not.toHaveProperty("verifiedContext");
    expect(repairInput).not.toHaveProperty("savedPreferences");
    expect(JSON.stringify(repairInput)).not.toContain("current_weight");
  });
  it("merges a partial same-food query without erasing known fields or adding a model call", async () => {
    const previous = { ...query, brand: "Rebisco", market: "Philippines" };
    const model = vi.fn().mockResolvedValue(
      ask("How many grams is one serving?", { ...chocolate, portion: null }),
    );
    const answer = await run("chocolate", {
      ...context,
      state: { awaiting: "clarification", query: previous },
    }, model);
    expect(answer.state?.query).toMatchObject({
      name: "Fudgee Barr",
      variant: "Chocolate",
      brand: "Rebisco",
      market: "Philippines",
      portion: { amount: 1, unit: "serving" },
    });
    expect(model).toHaveBeenCalledTimes(1);
  });
  it.each(["pro", "plus"] as const)(
    "keeps food context when a bar-size question uses weigh on %s",
    async (tier) => {
      const question = "How much does your chocolate bar weigh?";
      const model = vi.fn().mockResolvedValueOnce(
        tier === "pro"
          ? ask(question)
          : { kind: "clarify", question, query: null },
      ).mockResolvedValueOnce({ query: chocolate });
      const answer = await adaptiveTurn(
        req("chocolate"),
        { ...context, state: { awaiting: "clarification", query } },
        progress,
        tier,
        model,
        vi.fn(),
        new Date(),
      );
      expect(answer.state?.query).toEqual(chocolate);
      expect(model).toHaveBeenCalledTimes(2);
      expect(answer.draft).toBeUndefined();
    },
  );
  it("uses explicit35g with the retained product/flavor without inventing a package weight", async () => {
    const answer = deterministicTurn(req("35g"), {
      ...context,
      state: { awaiting: "clarification", query: chocolate },
    });
    expect(answer?.lookup_query).toEqual({
      ...chocolate,
      portion: { amount: 35, unit: "g" },
    });
    const result = await searchNutrition(answer!.lookup_query!, {
      signal: new AbortController().signal,
      personal: async () => [],
      gist: async () => [{
        name: "Fudgee Barr Chocolate",
        unit: "g",
        c: 200,
        p: 10,
        cb: 30,
        f: 4,
      }],
    }, "preferred");
    expect(result).toMatchObject({
      kind: "found",
      food: {
        grams: 35,
        calories: 70,
        protein: 3.5,
        carbs: 10.5,
        fat: 1.4,
        query: { variant: "Chocolate", packageGrams: null },
      },
    });
    expect(answer?.confirm).toBeUndefined();
  });
  it("still requires a supported mass conversion for one serving", async () => {
    const gist = vi.fn();
    const result = await searchNutrition(chocolate, {
      signal: new AbortController().signal,
      personal: async () => [],
      gist,
    }, "preferred");
    expect(result.kind).toBe("clarification");
    expect(gist).not.toHaveBeenCalled();
  });
  it("can recover an older broken clarification on a bare gram reply using bounded recent context", async () => {
    const ctx: BeeContext = {
      ...context,
      state: {
        awaiting: "clarification",
        question: "Which food and preparation?",
      },
      recent: [
        { role: "user", text: "chocolate" },
        {
          role: "assistant",
          text: "How many grams in one serving of chocolate Fudgee Barr?",
        },
        { role: "user", text: "35g" },
        { role: "assistant", text: "Which food and preparation?" },
      ],
    };
    expect(deterministicTurn(req("35g"), ctx)).toBeNull();
    const q = { ...chocolate, portion: { amount: 35, unit: "g" as const } };
    const model = vi.fn().mockResolvedValueOnce(ask("Which food?"))
      .mockResolvedValueOnce({ query: q });
    const search = vi.fn().mockResolvedValue({
      kind: "unavailable",
      message: "No independently usable label found.",
    });
    const answer = await run("35g", ctx, model, search);
    expect(search).toHaveBeenCalledWith(q);
    expect(answer.state?.query).toEqual(q);
    expect(answer.needsWeb).toEqual(q);
    expect(answer.draft).toBeUndefined();
  });
  it("does not restore a cancelled food from old messages or guess on an empty thread", () => {
    const cancelled: BeeContext = {
      ...context,
      state: { awaiting: "clarification" },
      recent: [{ role: "assistant", text: "Which chocolate bar serving?" }, {
        role: "assistant",
        text: "Cancelled.",
      }],
    };
    for (const ctx of [context, cancelled]) {
      expect(deterministicTurn(req("35g"), ctx)?.text).toMatch(/which food/i);
    }
  });
  it("does not carry food context into a weight clarification", async () => {
    const model = vi.fn().mockResolvedValue(
      ask("Is your body weight in kg or lb?"),
    );
    const answer = await run("my weight is72.4", {
      ...context,
      state: { awaiting: "clarification", query: chocolate },
    }, model);
    expect(answer.state?.query).toBeUndefined();
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("does not carry brand/flavor/package into a different food", async () => {
    const egg: FoodQuery = {
      ...query,
      name: "egg whites",
      variant: null,
      brand: null,
      packageGrams: null,
      portion: { amount: 35, unit: "g" },
    };
    const model = vi.fn().mockResolvedValue(
      ask("Were the egg whites raw or cooked?", egg),
    );
    const answer = await run("egg whites instead", {
      ...context,
      state: {
        awaiting: "clarification",
        query: { ...chocolate, brand: "Rebisco", packageGrams: 40 },
      },
    }, model);
    expect(answer.state?.query).toEqual(egg);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it("does not reuse the old package size after changing product flavor", async () => {
    const dark = { ...query, variant: "Dark Chocolate", portion: null };
    const model = vi.fn().mockResolvedValue(
      ask("What is the dark chocolate bar size?", dark),
    );
    const answer = await run("actually dark chocolate", {
      ...context,
      state: {
        awaiting: "clarification",
        query: { ...chocolate, packageGrams: 40 },
      },
    }, model);
    expect(answer.state?.query).toEqual({ ...dark, portion: query.portion });
  });
  it("rejects repair output that attempts to authorize writes or memory changes", async () => {
    const model = vi.fn().mockResolvedValueOnce(ask("Which flavor?"))
      .mockResolvedValueOnce({
        query: chocolate,
        confirm: true,
        memory: { key: "preferred_units", value: "g" },
      });
    await expect(run("fudgee bar 1 serving", context, model)).rejects.toThrow();
  });
  it("keeps an ordinary clarification when no food can be identified", async () => {
    const model = vi.fn().mockResolvedValueOnce(ask("Which food do you mean?"))
      .mockResolvedValueOnce({ query: null });
    const answer = await run("How many calories?", context, model);
    expect(answer.text).toBe("Which food do you mean?");
    expect(answer.state?.query).toBeUndefined();
    expect(answer.confirm).toBeUndefined();
  });
  it.each(["pro", "plus"] as const)(
    "does not revive stale food after a null recovery on %s",
    async (tier) => {
      const model = vi.fn().mockResolvedValueOnce(
        tier === "pro" ? ask("Which food do you mean?") : {
          kind: "clarify",
          question: "Which food do you mean?",
          query: null,
        },
      ).mockResolvedValueOnce({ query: null });
      const search = vi.fn();
      const answer = await adaptiveTurn(
        req("a different food, not sure which one"),
        { ...context, state: { awaiting: "clarification", query: chocolate } },
        progress,
        tier,
        model,
        search,
        new Date(),
      );
      expect(answer.state?.query).toBeUndefined();
      expect(search).not.toHaveBeenCalled();
      expect(answer.draft).toBeUndefined();
    },
  );
  it("repairs Plus clarification without sending profile or durable preferences", async () => {
    const model = vi.fn().mockResolvedValueOnce({
      kind: "clarify",
      question: "How many grams?",
      query: null,
    }).mockResolvedValueOnce({ query: chocolate });
    const ctx = {
      ...context,
      state: { awaiting: "clarification" as const, query },
    };
    const answer = await adaptiveTurn(
      {
        ...req("chocolate"),
        command: { kind: "food_assist", text: "chocolate" },
      },
      ctx,
      progress,
      "plus",
      model,
      vi.fn(),
      new Date(),
    );
    expect(answer.state?.query).toEqual(chocolate);
    expect(model).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(model.mock.calls)).not.toContain("current_weight");
  });
  it("does not silently discard another food while repairing a clarification", async () => {
    const model = vi.fn().mockResolvedValueOnce(ask("Which bar flavor?"))
      .mockResolvedValueOnce({ query });
    const search = vi.fn();
    const answer = await run(
      "fudgee bar 1 serving and an egg",
      context,
      model,
      search,
    );
    expect(answer.text).toMatch(/individually/);
    expect(answer.draft).toBeUndefined();
    expect(search).not.toHaveBeenCalled();
  });
});
