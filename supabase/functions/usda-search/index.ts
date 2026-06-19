import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const USDA_API_KEY = Deno.env.get("USDA_API_KEY");
const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DEFAULT_DATA_TYPES = [
  "Foundation",
  "SR Legacy",
  "Survey (FNDDS)",
  "Branded",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });

const clampNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(next)));
};

const normalizeDataTypes = (value: unknown) => {
  if (!Array.isArray(value)) return DEFAULT_DATA_TYPES;

  const allowed = new Set(DEFAULT_DATA_TYPES);
  const dataTypes = value.filter(
    (item): item is string => typeof item === "string" && allowed.has(item)
  );

  return dataTypes.length > 0 ? dataTypes : DEFAULT_DATA_TYPES;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const auth = req.headers.get("Authorization");
  if (!auth) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  if (!USDA_API_KEY) {
    return jsonResponse(
      { foods: [], error: "USDA_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const requestBody = await req.json().catch(() => ({}));
  const query =
    typeof requestBody.query === "string" ? requestBody.query.trim() : "";
  if (!query || typeof query !== "string") {
    return jsonResponse({
      foods: [],
      totalHits: 0,
      currentPage: 1,
      totalPages: 0,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  }

  const pageSize = clampNumber(
    requestBody.pageSize,
    DEFAULT_PAGE_SIZE,
    10,
    MAX_PAGE_SIZE
  );
  const pageNumber = clampNumber(requestBody.pageNumber, 1, 1, 1000);
  const dataType = normalizeDataTypes(requestBody.dataType);

  const upstream = await fetch(
    `${USDA_BASE_URL}/foods/search?api_key=${USDA_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        dataType,
        pageSize,
        pageNumber,
      }),
    }
  );
  const upstreamText = await upstream.text();
  let payload: unknown;
  try {
    payload = JSON.parse(upstreamText);
  } catch {
    payload = { foods: [], error: upstreamText || "USDA search failed" };
  }

  return jsonResponse(payload, {
    status: upstream.status,
  });
});
