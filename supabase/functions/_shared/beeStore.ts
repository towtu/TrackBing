import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { BeeStore } from "./beeService.ts";
import type { BeeResult, BeeSnapshot } from "./beeTypes.ts";

/** Every service-role operation carries the validated session owner. */
export function createBeeStore(
  admin: SupabaseClient,
  userId: string,
): BeeStore {
  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await admin.rpc(name, { p_user: userId, ...args });
    if (error || data == null) throw new Error("database_error");
    return data as T;
  }
  return {
    begin: (request, fingerprint) =>
      rpc("bee_begin_turn", {
        p_thread: request.threadId ?? (request.command.kind === "load"
          ? request.command.threadId ?? null
          : null),
        p_request: request.requestId,
        p_fingerprint: fingerprint,
        p_expected_version: request.expectedVersion ?? null,
        p_timezone: request.timeZone,
        p_command: request.command,
      }),
    snapshot: (threadId) =>
      rpc<BeeSnapshot>("bee_snapshot", { p_thread: threadId }),
    finish: (request, lease, outcome) =>
      rpc<BeeResult>("bee_finish_turn", {
        p_thread: lease.thread_id,
        p_request: request.requestId,
        p_token: lease.token,
        p_outcome: outcome,
      }),
    reserve: (request, lease, fingerprint) =>
      rpc("reserve_ai_lookup", {
        p_request: request.requestId,
        p_fingerprint: fingerprint,
        p_token: lease.token,
      }),
    release: async (request, lease, success, result) => {
      const response = await rpc<{ ok: boolean }>("release_ai_lookup", {
        p_request: request.requestId,
        p_token: lease.token,
        p_success: success,
        p_result: result,
      });
      if (!response.ok) throw new Error("reservation_conflict");
    },
    reserveSearch: (request, lease) =>
      rpc("reserve_ai_search", {
        p_request: request.requestId,
        p_token: lease.token,
      }),
    measureSearch: async (request, lease, count) => {
      const result = await rpc<{ ok: boolean }>("measure_ai_search", {
        p_request: request.requestId,
        p_token: lease.token,
        p_count: count,
      });
      if (!result.ok) throw new Error("search_accounting_failed");
    },
    history: async (start, end) => {
      const { data, error } = await admin.from("food_logs").select(
        "name,calories,serving_size,serving_unit",
      ).eq("user_id", userId).gte("created_at", start).lt("created_at", end)
        .order("created_at", { ascending: true }).limit(31);
      if (error) throw new Error("history_unavailable");
      return data ?? [];
    },
  };
}
