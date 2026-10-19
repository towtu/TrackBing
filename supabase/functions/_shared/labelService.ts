import { readBoundedRequestJson } from "./beeRequest.ts";
import { requestFingerprint } from "./beeService.ts";
import {
  type LabelExtraction,
  parseLabelExtraction,
  stripLabelMetadata,
  validateLabelImage,
} from "./nutritionLabel.ts";
import type { DeepSeekUsage } from "./deepseekProviders.ts";
import type { BeeErrorCode } from "./beeTypes.ts";
export type LabelResult = { ok: true; label: LabelExtraction } | {
  ok: false;
  error: BeeErrorCode;
};
type Reservation = { ok: true; replay: false } | {
  ok: true;
  replay: true;
  result: LabelResult;
} | { ok: false; error: BeeErrorCode };
export interface LabelStore {
  policy(): Promise<BeeErrorCode | null>;
  reserve(id: string, fingerprint: string, token: string): Promise<Reservation>;
  finish(id: string, token: string, result: LabelResult | null): Promise<void>;
  record(id: string, token: string, usage: DeepSeekUsage): Promise<void>;
}
type Dependencies = {
  authenticate(header: string): Promise<{ id: string } | null>;
  store(id: string): LabelStore;
  configured(): boolean;
  extract(
    image: string,
    signal: AbortSignal,
    onUsage: (u: DeepSeekUsage) => void,
  ): Promise<LabelExtraction>;
};
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
function reply(result: LabelResult, status = 200) {
  return new Response(JSON.stringify(result), { status, headers });
}
export async function handleLabelRequest(
  req: Request,
  deps: Dependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") {
    return reply({ ok: false, error: "bad_request" }, 405);
  }
  const authorization = req.headers.get("authorization") ?? "";
  if (authorization.length > 8192 || !/^Bearer \S+$/i.test(authorization)) {
    return reply({ ok: false, error: "unauthorized" }, 401);
  }
  let user;
  try {
    user = await deps.authenticate(authorization);
  } catch {
    return reply({ ok: false, error: "unauthorized" }, 401);
  }
  if (!user) return reply({ ok: false, error: "unauthorized" }, 401);
  let image: string, id: string;
  try {
    const r = await readBoundedRequestJson(req, 2_700_000) as Record<
      string,
      unknown
    >;
    if (
      !r || typeof r !== "object" || Array.isArray(r) ||
      Object.keys(r).some((k) => !["requestId", "image"].includes(k)) ||
      typeof r.requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(r.requestId)
    ) throw new Error("bad_request");
    validateLabelImage(r.image);
    image = stripLabelMetadata(r.image as string);
    id = r.requestId;
  } catch {
    return reply({ ok: false, error: "bad_request" }, 400);
  }
  if (!deps.configured()) {
    return reply({ ok: false, error: "not_configured" }, 503);
  }
  const store = deps.store(user.id), token = crypto.randomUUID();
  let reserved = false;
  try {
    const policy = await store.policy();
    if (policy) {
      return reply(
        { ok: false, error: policy },
        policy === "upgrade_required" ? 402 : 403,
      );
    }
    const fingerprint = await requestFingerprint({
      endpoint: "ai-label",
      image,
    });
    const reservation = await store.reserve(id, fingerprint, token);
    if (!reservation.ok) {
      return reply(
        reservation,
        reservation.error === "busy" || reservation.error === "conflict"
          ? 409
          : 429,
      );
    }
    if (reservation.replay) {
      if (reservation.result.ok) parseLabelExtraction(reservation.result.label);
      return reply(reservation.result);
    }
    reserved = true;
    let usage: DeepSeekUsage | undefined;
    // Mark the attempt before HTTP: a killed function cannot repeat a paid read
    // with this key after lease expiry. A separate usage record adds actual tokens.
    await store.record(id, token, {
      inputTokens: 0,
      outputTokens: 0,
      searchQueries: 0,
    });
    let label: LabelExtraction;
    try {
      label = parseLabelExtraction(
        await deps.extract(
          image,
          AbortSignal.any([req.signal, AbortSignal.timeout(35_000)]),
          (u) => {
            usage = u;
          },
        ),
      );
    } finally {
      await store.record(
        id,
        token,
        usage ?? { inputTokens: 6000, outputTokens: 4096, searchQueries: 0 },
      );
    }
    const result: LabelResult = { ok: true, label };
    await store.finish(id, token, result);
    reserved = false;
    return reply(result);
  } catch {
    if (reserved) {
      try {
        await store.finish(id, token, null);
      } catch {
        console.error("label_budget_release_failed");
      }
    }
    return reply({ ok: false, error: "provider_unavailable" }, 503);
  }
}
