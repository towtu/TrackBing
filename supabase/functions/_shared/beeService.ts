import type {
  BeeErrorCode,
  BeeRequest,
  BeeResult,
  BeeSnapshot,
  FoodQuery,
  GroundedAnswer,
  PendingFood,
} from "./beeTypes.ts";
import { parseIntent, parseRequest, retainFoodList } from "./beeIntent.ts";
import { dayBounds, localDay, shiftDay } from "./beeDates.ts";
import {
  type ConversationState,
  deterministicTurn,
  type HistoryLog,
  historyReply,
  knownHistory,
  modelContext,
  resolveNutritionIntent,
  type TurnOutcome,
} from "./beeConversation.ts";
import { readBoundedRequestJson } from "./beeRequest.ts";
import type { GeminiUsage } from "./beeProviders.ts";
import type { NutritionResult } from "./beeNutrition.ts";

export type TurnLease = {
  ok: true;
  replay: false;
  thread_id: string;
  token: string;
  state: ConversationState;
  pending: PendingFood | null;
};
type BeginResult = TurnLease | { ok: true; replay: true; result: BeeResult } | {
  ok: false;
  error: BeeErrorCode;
};
type Reservation = { ok: true; replay: false } | {
  ok: true;
  replay: true;
  result: TurnOutcome;
} | { ok: false; error: BeeErrorCode };
export interface BeeStore {
  begin(request: BeeRequest, fingerprint: string): Promise<BeginResult>;
  snapshot(threadId: string): Promise<BeeSnapshot>;
  finish(
    request: BeeRequest,
    lease: TurnLease,
    outcome: TurnOutcome,
  ): Promise<BeeResult>;
  reserve(
    request: BeeRequest,
    lease: TurnLease,
    fingerprint: string,
  ): Promise<Reservation>;
  release(
    request: BeeRequest,
    lease: TurnLease,
    success: boolean,
    result: TurnOutcome | null,
  ): Promise<void>;
  reserveSearch(
    request: BeeRequest,
    lease: TurnLease,
  ): Promise<
    { ok: true; replay: boolean; search_remaining: number } | {
      ok: false;
      error: BeeErrorCode;
    }
  >;
  measureSearch(
    request: BeeRequest,
    lease: TurnLease,
    count: number,
  ): Promise<void>;
  history(start: string, end: string): Promise<HistoryLog[]>;
}
export type BeeDependencies = {
  authenticate(authorization: string): Promise<{ id: string } | null>;
  store(userId: string): BeeStore;
  interpret(
    context: ReturnType<typeof modelContext>,
    signal: AbortSignal,
  ): Promise<unknown>;
  search(
    query: FoodQuery,
    signal: AbortSignal,
    userId: string,
  ): Promise<NutritionResult>;
  ground(
    query: FoodQuery,
    signal: AbortSignal,
    onUsage: (usage: GeminiUsage) => void,
  ): Promise<GroundedAnswer>;
  searchEnabled(): boolean;
  configured(): boolean;
  now?: () => Date;
};

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function json(result: BeeResult, status = 200): Response {
  return new Response(JSON.stringify(result), { status, headers: HEADERS });
}

async function readRequest(req: Request): Promise<BeeRequest> {
  return parseRequest(await readBoundedRequestJson(req));
}

/** A canonical digest binds an idempotency key to the complete original command. */
export async function requestFingerprint(value: unknown): Promise<string> {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined).sort((
          [a],
          [b],
        ) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]),
      );
    }
    return input;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function handleBeeRequest(
  req: Request,
  deps: BeeDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: HEADERS });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "bad_request" }, 405);
  }
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.length > 8192 || !/^Bearer \S+$/i.test(authorization)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let user: { id: string } | null;
  try {
    user = await deps.authenticate(authorization);
  } catch {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  let request: BeeRequest;
  try {
    request = await readRequest(req);
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const store = deps.store(user.id);
  const fingerprint = await requestFingerprint({
    endpoint: "bee-chat",
    ...request,
  });
  let lease: TurnLease;
  try {
    const begun = await store.begin(request, fingerprint);
    if (!begun.ok) return json(begun);
    if (begun.replay) return json(begun.result);
    lease = begun;
  } catch {
    return json({ ok: false, error: "error" });
  }
  const finish = async (outcome: TurnOutcome): Promise<Response> => {
    try {
      const { liveAnswer, ...persisted } = outcome;
      const result = await store.finish(request, lease, persisted);
      return json(
        result.ok && liveAnswer
          ? { ...result, snapshot: { ...result.snapshot, liveAnswer } }
          : result,
      );
    } catch {
      return json({
        ok: false,
        error: outcome.confirm ? "save_failed" : "error",
      });
    }
  };
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(55_000)]);
  let reserved = false;
  try {
    const snapshot = await store.snapshot(lease.thread_id);
    const context = {
      state: lease.state,
      pending: lease.pending,
      memories: snapshot.memories,
      profile: snapshot.profile,
      recent: snapshot.messages.slice(-6),
    };
    let deterministic: TurnOutcome | null;
    try {
      deterministic = deterministicTurn(request, context);
    } catch {
      return await finish({
        text: "Please use a positive, reasonable portion, such as 100 grams.",
        invalidate_pending: true,
        state: { awaiting: "clarification", query: context.state.query },
      });
    }
    if (deterministic) return await finish(deterministic);
    if (request.command.kind !== "message") {
      return await finish({ error: "bad_request" });
    }
    const history = async (
      daysAgo: number,
      repeat: boolean,
    ): Promise<TurnOutcome> => {
      const day = shiftDay(
        localDay((deps.now ?? (() => new Date()))(), request.timeZone),
        -daysAgo,
      );
      const { start, end } = dayBounds(day, request.timeZone);
      const logs = await store.history(start, end);
      return {
        text: historyReply(day, logs.slice(0, 30), repeat, logs.length > 30),
        state: { awaiting: "none" },
        invalidate_pending: true,
      };
    };
    const known = knownHistory(request.command.text);
    if (known) return await finish(await history(known.daysAgo, known.repeat));
    if (!deps.configured()) return await finish({ error: "not_configured" });
    const reservation = await store.reserve(request, lease, fingerprint);
    if (!reservation.ok) return await finish({ error: reservation.error });
    if (reservation.replay) return await finish(reservation.result);
    reserved = true;
    const intent = retainFoodList(
      parseIntent(
        await deps.interpret(
          modelContext(request.command.text, context),
          signal,
        ),
      ),
      request.command.text,
    );
    const explicitWeb =
      /\b(search (?:again|(?:the )?web|online)|find (?:more|on (?:the )?web)|google (?:it|search))\b/i
        .test(request.command.text);
    const outcome = intent.kind === "history"
      ? await history(intent.daysAgo, intent.repeat)
      : await resolveNutritionIntent(
        intent,
        context,
        (query) =>
          explicitWeb
            ? Promise.resolve({
              kind: "unavailable" as const,
              message: "I couldn't verify a live search yet.",
            })
            : deps.search(query, signal, user.id),
      );
    if (
      intent.kind === "nutrition" && !outcome.draft &&
      outcome.state?.awaiting === "clarification" &&
      outcome.text?.startsWith("I couldn't verify")
    ) {
      if (!deps.searchEnabled()) {
        outcome.text =
          "Live search is unavailable right now. Try a barcode, a more specific food, or enter the package label in Add Food.";
      } else {
        const searchReservation = await store.reserveSearch(request, lease);
        if (!searchReservation.ok || searchReservation.replay) {
          await store.release(request, lease, false, null);
          reserved = false;
          return await finish({
            error: searchReservation.ok
              ? "search_unavailable"
              : searchReservation.error,
          });
        }
        let usage: GeminiUsage | undefined;
        let liveAnswer: GroundedAnswer;
        try {
          liveAnswer = await deps.ground(intent.query, signal, (value) => {
            usage = value;
          });
        } finally {
          if (usage) {
            await store.measureSearch(request, lease, usage.searchQueries);
          }
        }
        if (!usage) {
          await store.measureSearch(
            request,
            lease,
            liveAnswer.searchQueryCount,
          );
        }
        outcome.liveAnswer = liveAnswer;
        outcome.text =
          "I showed a live search answer. Search again to refresh it, or use a barcode or package label to add food.";
        outcome.state = { awaiting: "none", query: intent.query };
      }
    }
    // Match existing business policy: only a usable nutrition lookup costs a
    // credit. Interpretation/no-match failures retain the per-minute attempt.
    const { liveAnswer, ...persisted } = outcome;
    await store.release(
      request,
      lease,
      Boolean(outcome.draft || liveAnswer),
      persisted,
    );
    reserved = false;
    return await finish(outcome);
  } catch {
    if (reserved) {
      try {
        await store.release(request, lease, false, null);
      } catch {
        /* Lease expiry will reconcile a failed reservation atomically. */
      }
    }
    return await finish({ error: "provider_unavailable" });
  }
}
