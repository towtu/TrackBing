import type {
  BeeCommand,
  BeeErrorCode,
  BeeRequest,
  BeeResult,
  BeeSnapshot,
  NutritionEvidence,
  PendingAction,
} from "../../supabase/functions/_shared/beeTypes";
import { supabase } from "./supabase";
import { isSafeGroundingUrl } from "../../supabase/functions/_shared/beeGrounding";
import { isBeeGroundedAnswer } from "../components/ai/BeeGroundedAnswer.shared";

export type {
  BeeCommand,
  BeeErrorCode,
  BeeMemory,
  BeeMessage,
  BeeRequest,
  BeeResult,
  BeeSnapshot,
  GroundedAnswer,
  MemoryKey,
  PendingFood,
  PendingAction,
} from "../../supabase/functions/_shared/beeTypes";

export function createBeeRequest(
  command: BeeCommand,
  snapshot?: BeeSnapshot | null,
  timeZone = resolveBeeTimeZone(),
): BeeRequest {
  const pending = snapshot?.pending;
  return {
    requestId: createBeeRequestId(),
    ...(snapshot && { threadId: snapshot.thread.id, expectedVersion: snapshot.thread.version }),
    timeZone,
    command: (command.kind === "message" || command.kind === "food_assist") && pending?.status === "pending"
      ? { ...command, actionId: pending.id, reviewVersion: pending.review_version }
      : { ...command },
  };
}

/** Response loss keeps its idempotency key. A completed failure needs a refreshed turn. */
export function createBeeRetryRequest(
  request: BeeRequest,
  error: BeeErrorCode,
  refreshed?: BeeSnapshot | null,
  timeZone = resolveBeeTimeZone(),
): BeeRequest | null {
  if (error !== "provider_unavailable" && error !== "save_failed") return request;
  if (!refreshed || (request.threadId && request.threadId !== refreshed.thread.id)) return null;
  const command = request.command;
  if ((command.kind === "confirm" || command.kind === "cancel" || command.kind === "message") && command.actionId) {
    const pending = refreshed.pending;
    if (!pending || pending.id !== command.actionId || pending.review_version !== command.reviewVersion ||
        pending.time_zone !== timeZone || !isCurrentBeeReview(pending, refreshed)) return null;
  }
  return createBeeRequest(command, refreshed, timeZone);
}

/** Account-local transport. The caller retains each request unchanged for Retry. */
export function createBeeClient(userId: string) {
  let active = true;
  const requests = new Set<AbortController>();

  return {
    async send(request: BeeRequest): Promise<BeeResult | null> {
      if (!active) return null;
      const controller = new AbortController();
      requests.add(controller);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!active || (session && session.user.id !== userId)) return null;
        if (!session) return { ok: false, error: "unauthorized" };

        let result: BeeResult;
        try {
          const { data, error } = await supabase.functions.invoke<unknown>("bee-chat", {
            body: request,
            // Keep a token refresh/account switch from rebinding an existing request.
            headers: { Authorization: `Bearer ${session.access_token}` },
            signal: controller.signal,
            timeout: 75_000,
          });
          result = parseResult(data) ?? await resultFromError(error);
        } catch (error) {
          result = { ok: false, error: isNetworkError(error) ? "offline" : "error" };
        }
        const current = await supabase.auth.getSession();
        if (!active || current.data.session?.user.id !== userId) return null;
        return result;
      } catch (error) {
        return active ? { ok: false, error: isNetworkError(error) ? "offline" : "error" } : null;
      } finally {
        requests.delete(controller);
      }
    },
    dispose() {
      active = false;
      requests.forEach((request) => request.abort());
      requests.clear();
    },
  };
}

export function isCurrentBeeReview(
  draft: PendingAction,
  snapshot: BeeSnapshot | null,
  now = Date.now(),
): boolean {
  const pending = snapshot?.pending;
  return pending?.id === draft.id &&
    pending.review_version === draft.review_version &&
    pending.status === "pending" &&
    Date.parse(pending.expires_at) > now;
}

export function resolveBeeTimeZone(device?: { timeZone?: string; locale?: string }): string {
  let resolved = device;
  try {
    resolved ??= Intl.DateTimeFormat().resolvedOptions();
    if (resolved.timeZone) {
      new Intl.DateTimeFormat("en", { timeZone: resolved.timeZone }).format();
      return resolved.timeZone;
    }
  } catch {
    // Some native Intl implementations expose a locale without a timezone.
  }
  return /^(?:fil|tl)(?:-|$)|-PH(?:-|$)/i.test(resolved?.locale ?? "")
    ? "Asia/Manila"
    : "UTC";
}

export function getBeeSourceUrl(value: string): string | null {
  if (!isSafeGroundingUrl(value)) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const ERRORS: readonly BeeErrorCode[] = [
  "bad_request", "unauthorized", "not_found", "conflict", "busy", "expired",
  "stale_action", "over_free_quota", "over_pro_cap", "rate_limited",
  "provider_unavailable", "not_configured", "save_failed", "offline", "error",
  "search_unavailable", "upgrade_required", "pro_required", "monthly_request_limit", "monthly_insight_limit", "monthly_input_limit", "monthly_output_limit", "monthly_search_limit", "age_required", "age_restricted", "paid_data_unavailable", "stale_profile",
];

export function getBeeErrorFeedback(error: BeeErrorCode): {
  message: string;
  action: "retry" | "refresh" | "none";
} {
  switch (error) {
    case "upgrade_required":
      return {message: "AI food help requires Plus. Adaptive Bee requires Pro. Manual tracking stays free.", action: "none"};
    case "pro_required":
      return {message: "This Bee feature requires Pro. Your saved data and manual tracking remain available.", action: "none"};
    case "monthly_request_limit":
    case "monthly_insight_limit":
    case "monthly_input_limit":
    case "monthly_output_limit":
    case "monthly_search_limit":
      return {message: "You reached this month’s AI allowance. Check your plan for the reset date; manual tracking remains available.", action: "none"};
    case "age_required":
    case "age_restricted":
      return {message: "Bee AI is available to adults with an age saved in Profile. Manual tracking remains available.", action: "none"};
    case "paid_data_unavailable":
      return {message: "Bee is awaiting privacy configuration. Manual tracking is available.", action: "none"};
    case "stale_profile":
      return {message: "Your profile changed. Review a fresh proposal before saving.", action: "refresh"};
    case "unauthorized":
      return { message: "Sign in again to continue this conversation.", action: "none" };
    case "over_free_quota":
    case "over_pro_cap":
      return { message: "You've reached your AI allowance. You can still enter food manually.", action: "refresh" };
    case "conflict":
    case "stale_action":
      return { message: "This conversation has changed. Refresh to review the latest portion before adding it.", action: "refresh" };
    case "expired":
      return { message: "That food review expired. Refresh, then send the portion again to review it.", action: "refresh" };
    case "not_found":
      return { message: "That conversation is no longer available. Refresh to open your latest conversation.", action: "refresh" };
    case "busy":
      return { message: "Bee is finishing another request. Give it a moment, then retry.", action: "retry" };
    case "rate_limited":
      return { message: "Bee needs a short pause. Try this request again in a moment.", action: "retry" };
    case "provider_unavailable":
      return { message: "Bee couldn't reach the lookup service. Retry or enter the food manually.", action: "retry" };
    case "search_unavailable":
      return { message: "Live search is unavailable right now. You can scan a barcode or enter your package label manually.", action: "refresh" };
    case "not_configured":
      return { message: "Bee isn't available yet. You can still enter food manually.", action: "refresh" };
    case "save_failed":
      return { message: "Bee couldn't finish saving this food. Retry the same save to check it safely.", action: "retry" };
    case "offline":
      return { message: "Couldn't reach Bee. Check your connection, then retry. Your message is still here.", action: "retry" };
    case "bad_request":
      return { message: "Bee couldn't use that request. Refresh and try a shorter description.", action: "refresh" };
    default:
      return { message: "Bee couldn't finish that request. Your message is still here; try again.", action: "retry" };
  }
}

export function createBeeRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  // This is an idempotency marker, not a credential. Older native runtimes lack WebCrypto.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 3) | 8).toString(16);
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseResult(value: unknown): BeeResult | null {
  if (!record(value)) return null;
  if (value.ok === true && isSnapshot(value.snapshot)) return { ok: true, snapshot: value.snapshot };
  if (typeof value.error === "string" && ERRORS.includes(value.error as BeeErrorCode)) {
    return { ok: false, error: value.error as BeeErrorCode };
  }
  return null;
}

function isSnapshot(value: unknown): value is BeeSnapshot {
  if (!record(value) || !record(value.thread) || typeof value.thread.id !== "string" ||
      !Number.isInteger(value.thread.version) || !Array.isArray(value.messages) ||
      !Array.isArray(value.memories) || !record(value.profile)) return false;
  return value.messages.every((message) => record(message) &&
    typeof message.id === "string" && typeof message.text === "string" &&
    (message.role === "assistant" || message.role === "user") &&
    (!message.draft || isDraft(message.draft))) &&
    value.memories.every((memory) => record(memory) && typeof memory.value === "string" &&
      ["preferred_name", "preferred_units", "usual_product", "usual_preparation"].includes(String(memory.key))) &&
    (value.pending === null || isDraft(value.pending)) &&
    (value.liveAnswer === undefined || isBeeGroundedAnswer(value.liveAnswer));
}

function isDraft(value: unknown): value is PendingAction {
  if (!record(value) || typeof value.id !== "string" || !Number.isInteger(value.review_version) ||
      typeof value.expires_at !== "string") return false;
  if (value.kind === "weight") return record(value.weight) && typeof value.weight.weightKg === "number" && Number.isFinite(value.weight.weightKg) && value.weight.weightKg >= 30 && value.weight.weightKg <= 300 && ["kg","lb"].includes(String(value.weight.unit)) && typeof value.weight.originalAmount === "number" && Number.isFinite(value.weight.originalAmount) && typeof value.weight.localDate === "string" && typeof value.weight.updatesCurrentWeight === "boolean";
  if (value.kind === "goal") {const goal=value.goal;if(!record(goal)||!record(goal.previous)||!record(goal.next))return false;const next=goal.next;return ["calorie_target","protein_grams","carbs_grams","fat_grams"].every(key=>typeof next[key]==="number" && Number.isFinite(next[key]) && next[key]>=0);}
  if (!record(value.food)) return false;
  const food = value.food;
  return ["usda", "openfoodfacts", "my_food", "user_label", "trackbing_gist"].includes(String(food.source)) &&
    typeof food.name === "string" && typeof food.servingLabel === "string" &&
    (food.grams === null || (typeof food.grams === "number" && Number.isFinite(food.grams) && food.grams > 0)) &&
    [food.calories, food.protein, food.carbs, food.fat].every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0) &&
    isBeeNutritionEvidence(food.evidence);
}

export function isBeeNutritionEvidence(value: unknown): value is NutritionEvidence {
  if (!record(value) || !record(value.basis) || !record(value.basis.nutrients)) return false;
  const basis = value.basis;
  const nutrients = value.basis.nutrients;
  return typeof value.url === "string" && (value.url === "" || getBeeSourceUrl(value.url) !== null) &&
    [value.title, value.identity, value.retrievedAt, value.excerpt].every((text) => typeof text === "string") &&
    [value.attribution, value.license, value.sourceId].every((text) => text === undefined || typeof text === "string") &&
    (value.record === undefined || value.record === "independent" || value.record === "user_owned") &&
    ["g", "ml", "cup", "piece", "bar", "serving", "pack"].includes(String(basis.unit)) &&
    [basis.grams, basis.count, basis.milliliters].every((number) => number === null || (typeof number === "number" && Number.isFinite(number) && number > 0)) &&
    typeof nutrients.calories === "number" && Number.isFinite(nutrients.calories) && nutrients.calories >= 0 &&
    [nutrients.protein, nutrients.carbs, nutrients.fat].every((number) => number === null || (typeof number === "number" && Number.isFinite(number) && number >= 0));
}

async function resultFromError(error: unknown): Promise<BeeResult> {
  if (record(error) && record(error.context) && typeof error.context.json === "function") {
    try {
      const result = parseResult(await error.context.json());
      if (result) return result;
    } catch {
      // Non-JSON gateway failures cannot supply a safe, user-facing message.
    }
  }
  return { ok: false, error: isNetworkError(error) ? "offline" : "error" };
}

function isNetworkError(error: unknown): boolean {
  return record(error) && (
    error.name === "FunctionsFetchError" || error.name === "AbortError" ||
    (typeof error.message === "string" && /network|fetch|offline|timed?\s*out/i.test(error.message))
  );
}
