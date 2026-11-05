// No image storage, user-supplied URL fetches, or diary writes in this endpoint.
// eslint-disable-next-line import/no-unresolved -- Deno resolves JSR imports.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  handleLabelRequest,
  type LabelStore,
} from "../_shared/labelService.ts";
import { deepseekLabel } from "../_shared/deepseekProviders.ts";
const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(8000),
    ]),
  });
Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL"),
    anon = Deno.env.get("SUPABASE_ANON_KEY"),
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY") ?? "",
    model = Deno.env.get("DEEPSEEK_VISION_MODEL") ?? "deepseek-flash";
  if (!url || !anon || !service) {
    return new Response(
      JSON.stringify({ ok: false, error: "not_configured" }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundedFetch },
  });
  return handleLabelRequest(req, {
    authenticate: async (authorization) => {
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: boundedFetch,
          headers: { Authorization: authorization },
        },
      });
      const { data, error } = await client.auth.getUser();
      return error ? null : data.user;
    },
    configured: () =>
      Boolean(apiKey) && Deno.env.get("BEE_AI_ENABLED") !== "false" &&
      Deno.env.get("DEEPSEEK_LABEL_ENABLED") === "true",
    store: (userId) => {
      async function rpc<T>(
        name: string,
        args: Record<string, unknown>,
      ): Promise<T> {
        const { data, error } = await admin.rpc(name, {
          p_user: userId,
          ...args,
        });
        if (error || !data) throw new Error("database_error");
        return data as T;
      }
      const store: LabelStore = {
        policy: async () => {
          const e = await rpc<{ tier: string }>("resolve_entitlement", {});
          if (e.tier === "basic") return "upgrade_required";
          const { data, error } = await admin.from("user_goals").select("age")
            .eq("user_id", userId).maybeSingle();
          if (error) throw new Error("profile_unavailable");
          if (typeof data?.age !== "number") return "age_required";
          if (data.age < 18) return "age_restricted";
          return Deno.env.get("DEEPSEEK_DATA_USE_CONFIRMED") === "true"
            ? null
            : "paid_data_unavailable";
        },
        reserve: (id, fingerprint, token) =>
          rpc("reserve_ai_budget", {
            p_request: id,
            p_fingerprint: fingerprint,
            p_token: token,
            p_feature: "ai_food_assist",
            p_input_budget: 6000,
            p_output_budget: 4096,
          }),
        record: async (id, token, usage) => {
          const r = await rpc<{ ok: boolean }>("record_ai_call", {
            p_request: id,
            p_token: token,
            p_call: crypto.randomUUID(),
            p_input_tokens: usage.inputTokens,
            p_output_tokens: usage.outputTokens,
          });
          if (!r.ok) throw new Error("accounting_failed");
        },
        finish: async (id, token, result) => {
          const r = await rpc<{ ok: boolean }>("finish_ai_budget", {
            p_request: id,
            p_token: token,
            p_success: result !== null,
            p_result: result,
          });
          if (!r.ok) throw new Error("accounting_failed");
        },
      };
      return store;
    },
    extract: (image, signal, onUsage) =>
      deepseekLabel(image, {
        apiKey,
        model,
        signal,
        onUsage: (usage) => {
          console.info(
            JSON.stringify({ event: "label_provider_usage", ...usage }),
          );
          onUsage(usage);
        },
      }),
  });
});
