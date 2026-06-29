// ai-food: turns a food/meal description into validated macros via DeepSeek.
//
// Security: the DeepSeek key lives only in this function's env. The user is
// authenticated from their JWT; quota/entitlement is enforced here (the gate is
// the paywall, not the UI). DeepSeek output is treated as data and validated
// server-side before it is returned.
//
// Response contract:
//   200 { food }                         success
//   200 { error: "over_free_quota" | "over_pro_cap" }   quota denial (app state)
//   400 { error: "bad_request" }         missing/invalid query
//   401 { error: "unauthorized" }        no valid user
//   502 { error: "ai_unavailable" }      DeepSeek failed / unparseable
//
// Quota denial is a 200 with an error field so supabase-js surfaces it in
// `data` (non-2xx bodies land in error.context, which the client doesn't read).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateAndNormalize, type AiFood } from "../_shared/macros.ts";
import { currentPeriod, isProActive, decideQuota } from "../_shared/quota.ts";

const FREE_MONTHLY = 7;
const PRO_DAILY = 100;
const MAX_QUERY = 200;

const SYSTEM_PROMPT =
  `You are a nutrition database. Given a food or meal description, return ONLY JSON ` +
  `matching: {"name":string,"brand"?:string,"serving_label":string,"serving_grams":number,` +
  `"kcal":number,"protein":number,"carbs":number,"fat":number,` +
  `"ingredients"?:[{"name":string,"kcal":number,"protein":number,"carbs":number,"fat":number}],` +
  `"confidence":"high"|"medium"|"low","notes"?:string}. ` +
  `Macros are grams PER SERVING. Use realistic values. If unsure, set confidence "low".`;

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(401, { error: "unauthorized" });

  let body: { query?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const query = typeof body.query === "string" ? body.query.trim().slice(0, MAX_QUERY) : "";
  if (!query) return json(400, { error: "bad_request" });

  // Service-role client for privileged reads/writes (bypasses RLS).
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const period = currentPeriod(now);
  const dayPeriod = `${period}-${String(now.getUTCDate()).padStart(2, "0")}`;

  const { data: ent } = await admin
    .from("entitlements")
    .select("pro_until")
    .eq("user_id", user.id)
    .maybeSingle();
  const pro = isProActive(ent?.pro_until ?? null, now);

  const { data: monthRow } = await admin
    .from("ai_usage")
    .select("count")
    .eq("user_id", user.id)
    .eq("period", period)
    .maybeSingle();
  const { data: dayRow } = await admin
    .from("ai_usage")
    .select("count")
    .eq("user_id", user.id)
    .eq("period", dayPeriod)
    .maybeSingle();

  const decision = decideQuota({
    isPro: pro,
    monthCount: monthRow?.count ?? 0,
    dayCount: dayRow?.count ?? 0,
    freeMonthly: FREE_MONTHLY,
    proDaily: PRO_DAILY,
  });
  if (!decision.allowed) return json(200, { error: decision.reason });

  // Call DeepSeek (OpenAI-compatible chat completions).
  let dsRes: Response;
  try {
    dsRes = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("DEEPSEEK_API_KEY")!}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
  } catch {
    return json(502, { error: "ai_unavailable" });
  }
  if (!dsRes.ok) return json(502, { error: "ai_unavailable" });

  let parsed: unknown;
  try {
    const dsJson = await dsRes.json();
    parsed = JSON.parse(dsJson.choices?.[0]?.message?.content ?? "null");
  } catch {
    return json(502, { error: "ai_unavailable" });
  }

  const food: AiFood | null = validateAndNormalize(parsed);
  if (!food) return json(502, { error: "ai_unavailable" });

  // Best-effort usage increment (month + day) after a successful result.
  await admin.rpc("increment_ai_usage", { p_user: user.id, p_period: period });
  await admin.rpc("increment_ai_usage", { p_user: user.id, p_period: dayPeriod });

  return json(200, { food });
});
