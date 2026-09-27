import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleBeeRequest } from "../_shared/beeService.ts";
import { createBeeStore } from "../_shared/beeStore.ts";
import {
  geminiGrounded,
  geminiJson,
  type GeminiUsage,
} from "../_shared/beeProviders.ts";
import { searchNutrition } from "../_shared/beeNutrition.ts";
import { INTENT_PROMPT } from "../_shared/beeConversation.ts";

// Fixed destinations; no user-supplied URLs. Bound auth/database requests too.
const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.any([
      ...(init?.signal ? [init.signal] : []),
      AbortSignal.timeout(8000),
    ]),
  });
// Numeric usage only; no prompts, tokens, IDs, food queries or response bodies.
function reportUsage(usage: GeminiUsage) {
  console.info(JSON.stringify({ event: "bee_provider_usage", ...usage }));
}
Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.5-flash-lite";
  // Missing configuration never exposes an environment value in the response.
  if (!url || !anon || !service) {
    return new Response(
      JSON.stringify({ ok: false, error: "not_configured" }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundedFetch },
  });
  return handleBeeRequest(req, {
    authenticate: async (authorization) => {
      const client = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: authorization },
          fetch: boundedFetch,
        },
      });
      const { data, error } = await client.auth.getUser();
      return error ? null : data.user;
    },
    store: (userId) => createBeeStore(admin, userId),
    configured: () => Boolean(apiKey),
    interpret: (context, signal) =>
      geminiJson(INTENT_PROMPT, context, {
        apiKey,
        model,
        signal,
        maxTokens: 900,
        onUsage: reportUsage,
      }),
    searchEnabled: () => Deno.env.get("GEMINI_SEARCH_ENABLED") === "true",
    ground: (query, signal, onUsage) =>
      geminiGrounded(query, {
        apiKey,
        model,
        signal,
        maxTokens: 1600,
        onUsage: (usage) => {
          reportUsage(usage);
          onUsage(usage);
        },
      }),
    search: (query, signal, userId) =>
      searchNutrition(query, {
        usdaApiKey: Deno.env.get("USDA_API_KEY") ?? "",
        signal,
        personal: async (food) => {
          const escaped = food.name.replace(/[\\%_]/g, " ");
          const { data, error } = await admin.from("personal_foods").select(
            "id,name,calories,protein,carbs,fat,default_unit,ai_estimated",
          ).eq("user_id", userId).ilike("name", `%${escaped}%`).limit(5);
          if (error) throw new Error("personal_food_unavailable");
          return data ?? [];
        },
      }),
  });
});
