import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const USDA_API_KEY = Deno.env.get("USDA_API_KEY")!;
const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const auth = req.headers.get("Authorization");
  if (!auth) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const { query } = await req.json().catch(() => ({ query: "" }));
  if (!query || typeof query !== "string") {
    return new Response(JSON.stringify({ foods: [] }), {
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const url =
    `${USDA_BASE_URL}/foods/search?query=${encodeURIComponent(query)}` +
    `&dataType=Foundation,SR%20Legacy&pageSize=25&api_key=${USDA_API_KEY}`;

  const upstream = await fetch(url);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
});
