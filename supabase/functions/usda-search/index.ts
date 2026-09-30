// eslint-disable-next-line import/no-unresolved -- Edge Functions resolve this JSR import with Deno.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { readBoundedRequestJson } from "../_shared/beeRequest.ts";

const DATA_TYPES = ["Foundation", "SR Legacy", "Survey (FNDDS)", "Branded"];
const HEADERS = {
  "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
};
const json = (payload: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(payload), { status, headers: { ...HEADERS, ...headers } });
const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(8000)]) });
function integer(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error("bad_request");
  return value;
}
async function upstreamJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 512_000) throw new Error("unavailable");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = ""; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 512_000) throw new Error("unavailable");
      text += decoder.decode(value, { stream: true });
    }
    const value: unknown = JSON.parse(text + decoder.decode());
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).foods)) throw new Error("unavailable");
    return value as Record<string, unknown>;
  } finally { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.length > 8192 || !/^Bearer \S+$/i.test(authorization)) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL"); const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const key = Deno.env.get("USDA_API_KEY"); const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !key || !serviceKey) return json({ error: "not_configured" }, 503);
  let userId: string;
  try {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization }, fetch: boundedFetch } });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return json({ error: "unauthorized" }, 401);
    userId = data.user.id;
  } catch { return json({ error: "unauthorized" }, 401); }
  let body: Record<string, unknown>; let query: string; let pageSize: number; let pageNumber: number; let dataType: string[];
  try {
    const value = await readBoundedRequestJson(req);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("bad_request");
    body = value as Record<string, unknown>;
    if (Object.keys(body).some(field => !["query", "pageSize", "pageNumber", "dataType"].includes(field)) || typeof body.query !== "string" || !body.query.trim() || body.query.length > 1000 || /[\u0000-\u001f\u007f]/u.test(body.query)) throw new Error("bad_request");
    query = body.query.trim(); pageSize = integer(body.pageSize, 50, 100); pageNumber = integer(body.pageNumber, 1, 1000);
    if (body.dataType !== undefined && (!Array.isArray(body.dataType) || !body.dataType.length || body.dataType.length > 4 || body.dataType.some(value => typeof value !== "string" || !DATA_TYPES.includes(value)))) throw new Error("bad_request");
    dataType = body.dataType === undefined ? DATA_TYPES : body.dataType as string[];
  } catch { return json({ error: "bad_request" }, 400); }
  try {
    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } });
    // This independent provider limit is reserved before launch; it never spends AI credits.
    const { data, error } = await service.rpc("reserve_usda_request", { p_user: userId });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) throw new Error("unavailable");
    const quota = data as Record<string, unknown>;
    if (quota.ok === false && quota.error === "rate_limited" && typeof quota.retry_after === "number" && Number.isInteger(quota.retry_after) && quota.retry_after >= 1 && quota.retry_after <= 60) {
      return json({ error: "rate_limited" }, 429, { "Retry-After": String(quota.retry_after) });
    }
    if (quota.ok !== true || typeof quota.remaining !== "number" || !Number.isInteger(quota.remaining) || quota.remaining < 0 || quota.remaining > 29) throw new Error("unavailable");
  } catch { return json({ error: "nutrition_unavailable" }, 503); }
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(8000)]);
  let removeAbort = () => {};
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(new Error("unavailable"));
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener("abort", onAbort, { once: true }); removeAbort = () => signal.removeEventListener("abort", onAbort);
    });
    const operation = async () => {
      const response = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`, { method: "POST", redirect: "error", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, dataType, pageSize, pageNumber }) });
      return upstreamJson(response);
    };
    const result = await Promise.race([operation(), cancelled]);
    // Do not proxy provider errors, headers, or arbitrary diagnostic fields to clients.
    return json({ foods: result.foods, totalHits: result.totalHits, currentPage: result.currentPage, totalPages: result.totalPages, pageSize });
  } catch { return json({ foods: [], error: "nutrition_unavailable" }, 502); }
  finally { removeAbort(); }
});
