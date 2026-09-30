import {
  BEE_DECISION_PROMPT,
  BEE_REPLY_PROMPT,
  makeGoalDraft,
  makeWeightDraft,
  parseBeeDecision,
  parseBeeReply,
  type WeightRecord,
  weightTrend,
} from "./beeAdaptive.ts";
import { parseIntent, retainFoodList } from "./beeIntent.ts";
import {
  type BeeContext,
  INTENT_PROMPT,
  modelContext,
  resolveNutritionIntent,
  type TurnOutcome,
} from "./beeConversation.ts";
import type { BeeRequest, BeeTier, FoodQuery } from "./beeTypes.ts";
import type { NutritionResult } from "./beeNutrition.ts";
export type ProgressContext = {
  localDate: string;
  totals: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    count: number;
  };
  recentLogTimes: string[];
  weights: WeightRecord[];
  revision: string;
};
export async function adaptiveTurn(
  request: BeeRequest,
  context: BeeContext,
  progress: ProgressContext,
  tier: BeeTier,
  model: (system: string, input: unknown) => Promise<unknown>,
  search: (q: FoodQuery) => Promise<NutritionResult>,
  now: Date,
): Promise<TurnOutcome & { needsWeb?: FoodQuery }> {
  const command = request.command;
  const text = command.kind === "insight"
    ? "Provide one fresh dashboard insight based on recorded data."
    : command.kind === "message" || command.kind === "food_assist"
    ? command.text
    : "";
  if (tier === "plus") {
    const intent = retainFoodList(
      parseIntent(await model(INTENT_PROMPT, modelContext(text, {...context,memories:[],profile:{}}))),
      text,
    );
    let missed = false;
    const outcome = await resolveNutritionIntent(intent, context, async (q) => {
      const result = await search(q);
      missed = result.kind === "unavailable";
      return result;
    });
    return {
      ...outcome,
      ...(intent.kind === "nutrition" && missed
        ? { needsWeb: intent.query }
        : {}),
    };
  }
  const verifiedContext = {
    localDate: progress.localDate,
    today: progress.totals,
    recentLogTimes: progress.recentLogTimes,
    goal: context.profile,
    measurements: progress.weights,
    recordedTrend: weightTrend(progress.weights),
    savedPreferences: context.memories.map(({ key, value }) => ({
      key,
      value,
    })),
    activePending: context.pending ?? null,
  };
  const decision = parseBeeDecision(
    await model(BEE_DECISION_PROMPT, {
      ...modelContext(text, context),
      verifiedContext,
      dashboard: command.kind === "insight",
    }),
  );
  const state = {
    awaiting: "none" as const,
    suggested_pose: decision.suggestedPose,
  };
  if (command.kind === "insight") {
    if (!["answer", "nothing_more", "read_data"].includes(decision.nextStep)) {
      throw new Error("invalid_insight");
    }
    return {
      text: decision.reply,
      state,
      suggested_pose: decision.suggestedPose,
    };
  }
  const base = {
    text: decision.reply,
    state,
    suggested_pose: decision.suggestedPose,
    invalidate_pending: true,
  };
  if (decision.nextStep === "ask_one_question") {
    return {
      ...base,
      text: decision.followUpQuestion ?? decision.reply,
      state: {
        ...state,
        awaiting: "clarification",
        question: decision.followUpQuestion ?? decision.reply,
        ...(decision.query ? { query: decision.query } : {}),
      },
    };
  }
  if (decision.nextStep === "propose_weight") {
    if (!context.profile.current_weight) {
      return {
        ...base,
        text:
          "Complete your body measurements in Profile before saving a weight check-in here.",
      };
    }
    const draft = makeWeightDraft(
      text,
      now,
      request.timeZone,
      progress.weights,
      context.pending?.kind === "weight" ? context.pending.weight : undefined,
    );
    if (!draft) {
      return {
        ...base,
        text:
          "What weight, kg or lb, and measurement date should I review? TrackBing currently supports 30–300 kg; values outside that range need support rather than being clamped.",
        state: {
          ...state,
          awaiting: "clarification",
          question: "What weight and unit should I review?",
        },
      };
    }
    const generated = parseBeeReply(
      await model(BEE_REPLY_PROMPT, {
        userMessage: text,
        verifiedContext,
        weightReview: draft,
      }),
    );
    return {
      ...base,
      text: generated.reply,
      suggested_pose: generated.suggestedPose,
      state: { ...state, awaiting: "review" },
      weight_draft: draft,
    };
  }
  if (decision.nextStep === "propose_goal_review") {
    const result = makeGoalDraft(context.profile, text);
    if (result.kind === "clarify") {
      return {
        ...base,
        text: result.question,
        state: {
          ...state,
          awaiting: "clarification",
          question: result.question,
        },
      };
    }
    const generated = parseBeeReply(
      await model(BEE_REPLY_PROMPT, {
        userMessage: text,
        verifiedContext,
        goalReview: result.goal,
      }),
    );
    return {
      ...base,
      text: generated.reply,
      suggested_pose: generated.suggestedPose,
      state: { ...state, awaiting: "review" },
      goal_draft: result.goal,
    };
  }
  if (
    ["lookup_food", "propose_food", "search_food_web"].includes(
      decision.nextStep,
    )
  ) {
    if (!decision.query) {
      return {
        ...base,
        text: "Which food, preparation and portion should I look up?",
        state: {
          ...state,
          awaiting: "clarification",
          question: "Which food and portion?",
        },
      };
    }
    const intent = retainFoodList(
      { kind: "nutrition", query: decision.query },
      text,
    );
    let missed = false;
    const result = await resolveNutritionIntent(intent, context, async (q) => {
      const result = await search(q);
      missed = result.kind === "unavailable";
      return result;
    });
    if (result.draft) {
      const generated = parseBeeReply(
        await model(BEE_REPLY_PROMPT, {
          userMessage: text,
          foodReview: result.draft,
          notSaved: true,
        }),
      );
      return {
        ...result,
        text: generated.reply,
        suggested_pose: generated.suggestedPose,
      };
    }
    // Missing variant/portion is a clarification; search is automatic only on a true source miss.
    return {
      ...result,
      suggested_pose: "thinking",
      ...(intent.kind === "nutrition" && missed
        ? { needsWeb: intent.query }
        : {}),
    };
  }
  if (decision.nextStep === "read_data") {
    // Allowlisted reads are already in this fresh bounded owner snapshot; no arbitrary queries.
    const generated = parseBeeReply(
      await model(BEE_REPLY_PROMPT, {
        userMessage: text,
        requestedReads: decision.requestedReads ?? [],
        verifiedContext,
      }),
    );
    return {
      ...base,
      text: generated.reply,
      suggested_pose: generated.suggestedPose,
    };
  }
  if (decision.nextStep === "remember") {
    return {
      ...base,
      text:
        "Save a preference explicitly, for example “Remember that I prefer grams,” or use Memories.",
    };
  }
  return base;
}
