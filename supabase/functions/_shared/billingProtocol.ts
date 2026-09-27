function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("bad_request");
  }
  return value as Record<string, unknown>;
}
export type PaidProduct = {
  provider: "web" | "apple" | "google";
  id: string;
  basePlan?: string;
  tier: "plus" | "pro";
  interval: "monthly" | "annual";
};
export type Subscription = {
  external_id: string;
  product_id: string;
  tier: "plus" | "pro";
  status: "active" | "cancelled" | "grace" | "expired" | "revoked";
  current_period_start: string;
  current_period_end: string;
  paid_through: string;
  auto_renew: boolean;
  billing_interval: "monthly" | "annual";
  transaction_id: string | null;
};
export type BillingCommand =
  | { action: "status" }
  | { action: "catalog" }
  | {
    action: "web_checkout";
    tier: "plus" | "pro";
    interval: "monthly" | "annual";
    request_id: string;
    first_name: string;
    last_name: string;
  }
  | { action: "web_cancel"; subscription_id: string }
  | {
    action: "web_change_plan";
    subscription_id: string;
    tier: "plus" | "pro";
    interval: "monthly" | "annual";
  }
  | { action: "verify_google"; token: string }
  | { action: "verify_apple"; transaction_id: string };
function string(value: unknown, max: number): string {
  if (
    typeof value !== "string" || !value.trim() || value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) throw new Error("bad_request");
  return value.trim();
}
export function parseBillingCommand(value: unknown): BillingCommand {
  const data = record(value);
  const fields: Record<string, string[]> = {
    status: [],
    catalog: [],
    web_checkout: ["tier", "interval", "request_id", "first_name", "last_name"],
    web_cancel: ["subscription_id"],
    web_change_plan: ["subscription_id", "tier", "interval"],
    verify_google: ["token"],
    verify_apple: ["transaction_id"],
  };
  const action = string(data.action, 32);
  if (
    !fields[action] ||
    Object.keys(data).some((k) => k !== "action" && !fields[action].includes(k))
  ) throw new Error("bad_request");
  if (action === "status" || action === "catalog") return { action };
  if (action === "web_checkout") {
    if (
      !["plus", "pro"].includes(String(data.tier)) ||
      !["monthly", "annual"].includes(String(data.interval)) ||
      !/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(String(data.request_id))
    ) throw new Error("bad_request");
    return {
      action,
      tier: data.tier as "plus" | "pro",
      interval: data.interval as "monthly" | "annual",
      request_id: string(data.request_id, 36),
      first_name: string(data.first_name, 60),
      last_name: string(data.last_name, 60),
    };
  }
  if (action === "web_change_plan") {
    if (
      !["plus", "pro"].includes(String(data.tier)) ||
      !["monthly", "annual"].includes(String(data.interval))
    ) throw new Error("bad_request");
    return {
      action,
      subscription_id: string(data.subscription_id, 200),
      tier: data.tier as "plus" | "pro",
      interval: data.interval as "monthly" | "annual",
    };
  }
  if (action === "web_cancel") {
    return { action, subscription_id: string(data.subscription_id, 200) };
  }
  if (action === "verify_google") {
    return { action, token: string(data.token, 2048) };
  }
  return {
    action: "verify_apple",
    transaction_id: string(data.transaction_id, 200),
  };
}
export function productCatalog(raw: string): PaidProduct[] {
  const data: unknown = JSON.parse(raw || "[]");
  if (!Array.isArray(data) || data.length > 12) throw new Error("bad_catalog");
  const result: PaidProduct[] = data.map((v) => {
    const p = record(v);
    if (
      !["web", "apple", "google"].includes(String(p.provider)) ||
      !["plus", "pro"].includes(String(p.tier)) ||
      !["monthly", "annual"].includes(String(p.interval))
    ) throw new Error("bad_catalog");
    return {
      provider: p.provider,
      id: string(p.id, 200),
      tier: p.tier,
      interval: p.interval,
      ...(p.basePlan ? { basePlan: string(p.basePlan, 100) } : {}),
    } as PaidProduct;
  });
  if (
    new Set(result.map((p) => `${p.provider}:${p.id}:${p.basePlan ?? ""}`))
      .size !== result.length
  ) throw new Error("duplicate_product");
  return result;
}
export function safeCheckoutUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" && !url.username && !url.password &&
        [
          "payments.paymaya.com",
          "payments.maya.ph",
          "checkout.paymongo.com",
          "pm.link",
        ].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export async function verifyPayMongoSignature(
  raw: string,
  header: string,
  secret: string,
  live: boolean,
  now = Date.now(),
): Promise<boolean> {
  if (!secret || raw.length > 100000 || header.length > 1000) return false;
  const parts: Record<string, string> = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=")),
  );
  const t = Number(parts.t), sig = parts[live ? "li" : "te"];
  if (
    !Number.isSafeInteger(t) || Math.abs(now - t * 1000) > 300000 || !sig ||
    !/^[0-9a-f]{64}$/i.test(sig)
  ) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(sig.match(/../g)!, (v) => parseInt(v, 16)),
    new TextEncoder().encode(`${t}.${raw}`),
  );
}
const iso = (value: unknown) => {
  const date = new Date(typeof value === "number" ? value : string(value, 64));
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_date");
  return date.toISOString();
};
/** Input must already have been retrieved using Google's authenticated Publisher API. */
export function normalizeGoogleSubscription(
  value: unknown,
  ownerHash: string,
  tokenHash: string,
  catalog: PaidProduct[],
): Subscription {
  const d = record(value), accounts = record(d.externalAccountIdentifiers);
  if (accounts.obfuscatedExternalAccountId !== ownerHash) {
    throw new Error("ownership_conflict");
  }
  if (!Array.isArray(d.lineItems) || d.lineItems.length !== 1) {
    throw new Error("unsupported_subscription");
  }
  const line = record(d.lineItems[0]), offer = record(line.offerDetails);
  if (offer.offerId) throw new Error("unsupported_offer");
  const product = catalog.find((p) =>
    p.provider === "google" && p.id === line.productId &&
    p.basePlan === offer.basePlanId
  );
  if (!product) throw new Error("unknown_product");
  const status = d.subscriptionState;
  return {
    external_id: tokenHash,
    product_id: product.id,
    tier: product.tier,
    billing_interval: product.interval,
    current_period_start: iso(d.startTime),
    current_period_end: iso(line.expiryTime),
    paid_through: iso(line.expiryTime),
    auto_renew: record(line.autoRenewingPlan ?? {}).autoRenewEnabled === true,
    transaction_id: typeof line.latestSuccessfulOrderId === "string"
      ? line.latestSuccessfulOrderId
      : null,
    status: record(d.canceledStateContext ?? {}).replacementCancellation != null
      ? "expired"
      : status === "SUBSCRIPTION_STATE_ACTIVE"
      ? "active"
      : status === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
      ? "grace"
      : status === "SUBSCRIPTION_STATE_CANCELED"
      ? "cancelled"
      : "expired",
  };
}
/** Only SignedDataVerifier-validated transaction/renewal data may reach this mapper. */
export function normalizeAppleSubscription(
  value: unknown,
  renewalValue: unknown,
  userId: string,
  catalog: PaidProduct[],
  status?: number,
): Subscription {
  const tx = record(value), renewal = record(renewalValue);
  if (
    tx.appAccountToken !== userId || tx.type !== "Auto-Renewable Subscription"
  ) throw new Error("ownership_conflict");
  const p = catalog.find((p) =>
    p.provider === "apple" && p.id === tx.productId
  );
  if (!p) throw new Error("unknown_product");
  const grace =
    status === 4 && typeof renewal.gracePeriodExpiresDate === "number"
      ? renewal.gracePeriodExpiresDate
      : tx.expiresDate;
  return {
    external_id: string(tx.originalTransactionId, 200),
    product_id: p.id,
    tier: p.tier,
    billing_interval: p.interval,
    current_period_start: iso(tx.purchaseDate),
    current_period_end: iso(tx.expiresDate),
    paid_through: iso(grace),
    auto_renew: renewal.autoRenewStatus === 1,
    transaction_id: string(tx.transactionId, 200),
    status: tx.revocationDate || status === 5
      ? "revoked"
      : status === 3 || status === 2
      ? "expired"
      : status === 4
      ? "grace"
      : renewal.autoRenewStatus === 0
      ? "cancelled"
      : "active",
  };
}
export async function digestId(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(hash)].map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
