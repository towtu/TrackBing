// Compatibility lookup endpoint. Independent records can produce editable food;
// Google Search produces only a transient answer with attribution, never macros to save.
// eslint-disable-next-line import/no-unresolved -- Edge Functions resolve this JSR import with Deno.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleLegacyFoodRequest, LEGACY_FOOD_HEADERS, type LegacyFoodStore } from "../_shared/beeLegacyFood.ts";
import { geminiGrounded, geminiJson, type GeminiUsage } from "../_shared/beeProviders.ts";
import { searchNutrition } from "../_shared/beeNutrition.ts";
import { INTENT_PROMPT } from "../_shared/beeConversation.ts";

const boundedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, redirect: "error", signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(8000)]),
});
function usage(usage: GeminiUsage): void {
  // Numeric usage only: no prompt, product queries, diary, credentials, or grounded answers.
  console.info("gemini_usage", { endpoint: "ai-food", ...usage });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: LEGACY_FOOD_HEADERS });
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
  if (!url || !anon || !service) return new Response(JSON.stringify({ error: "not_configured" }), { status: 503, headers: LEGACY_FOOD_HEADERS });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } });
  const store = (userId: string): LegacyFoodStore => {
    async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await admin.rpc(name, { p_user: userId, ...args });
      if (error || data === null) throw new Error("database_error");
      return data as T;
    }
    return {
      policy: async () => {
        const ent=await rpc<{tier:string}>("resolve_entitlement",{});
        if(ent.tier==="basic") return "upgrade_required";
        const {data,error}=await admin.from("user_goals").select("age").eq("user_id",userId).maybeSingle();
        if(error)throw new Error("profile_unavailable");
        if(typeof data?.age !== "number")return "age_required";
        if(data.age<18)return "age_restricted";
        return Deno.env.get("GEMINI_PAID_DATA_USE_CONFIRMED")==="true" ? null : "paid_data_unavailable";
      },
      recordCall: async(request,token,callId,value)=>{const result=await rpc<{ok:boolean}>("record_ai_call",{p_request:request.requestId,p_token:token,p_call:callId,p_input_tokens:value.inputTokens,p_output_tokens:value.outputTokens});if(!result.ok)throw new Error("accounting_failed");},
      reserve: (request, fingerprint, token) => rpc("reserve_ai_budget", { p_request: request.requestId, p_fingerprint: fingerprint, p_token: token, p_feature:"ai_food_assist",p_input_budget:15000,p_output_budget:12288 }),
      release: async (request, token, success, result) => {
        const response = await rpc<{ ok: boolean }>("finish_ai_budget", { p_request: request.requestId, p_token: token, p_success: success, p_result: result });
        if (!response.ok) throw new Error("reservation_conflict");
      },
      reserveSearch: (request, token) => rpc("reserve_ai_search_queries", { p_request: request.requestId, p_token: token,p_call:request.requestId,p_queries:3 }),
      measureSearch: async (request, token, count) => {
        const response = await rpc<{ ok: boolean }>("measure_ai_search_queries", { p_request: request.requestId, p_token: token,p_call:request.requestId,p_actual:count });
        if (!response.ok) throw new Error("search_accounting_failed");
      },
    };
  };
  return handleLegacyFoodRequest(req, {
    authenticate: async authorization => {
      const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization }, fetch: boundedFetch } });
      const { data, error } = await client.auth.getUser();
      return error ? null : data.user;
    },
    store, configured: () => Boolean(apiKey), searchEnabled: () => Deno.env.get("GEMINI_SEARCH_ENABLED") === "true",
    interpret: (text, signal, onUsage) => geminiJson(INTENT_PROMPT, { userMessage: text }, { apiKey, model, signal, maxTokens: 4096, onUsage: value=>{usage(value);onUsage?.(value);} }),
    ground: (query, signal, measuredUsage) => geminiGrounded(query, { apiKey, model, signal, maxTokens: 4096, onUsage: value => { usage(value); measuredUsage(value); } }),
    resolve: (query, signal, userId) => searchNutrition(query, {
      usdaApiKey: Deno.env.get("USDA_API_KEY") ?? "", signal,
      personal: async food => {
        const escaped = food.name.replace(/[\\%_]/g, " ");
        const { data, error } = await admin.from("personal_foods").select("id,name,calories,protein,carbs,fat,default_unit,ai_estimated").eq("user_id", userId).ilike("name", `%${escaped}%`).limit(5);
        if (error) throw new Error("personal_food_unavailable");
        return data ?? [];
      },
    }),
  });
});
