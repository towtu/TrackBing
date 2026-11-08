import {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
} from "npm:@apple/app-store-server-library@3.1.0";
import { Buffer } from "node:buffer";
import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
} from "npm:jose@6.2.12";
import { readBoundedRequestText } from "./beeRequest.ts";
import { record } from "./beeIntent.ts";
import {
  digestId,
  normalizeAppleSubscription,
  normalizeGoogleSubscription,
  type PaidProduct,
  productCatalog,
  safeCheckoutUrl,
  type Subscription,
} from "./billingProtocol.ts";
export const env = (name: string): string => Deno.env.get(name) ?? "";
export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error("not_configured");
  return value;
}
export const catalog = () => productCatalog(env("BILLING_PRODUCTS_JSON"));
export async function providerJson(
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.any([
      ...(init.signal ? [init.signal] : []),
      AbortSignal.timeout(12000),
    ]),
  });
  if (!response.ok) throw new Error("provider_unavailable");
  const text = await readBoundedRequestText({
    headers: response.headers,
    body: response.body,
    signal: init.signal ?? AbortSignal.timeout(12000),
  }, 150000);
  return JSON.parse(text);
}
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 8000 },
);
export async function verifyGooglePush(authorization: string): Promise<void> {
  if (!/^Bearer \S+$/.test(authorization)) throw new Error("invalid_signature");
  const { payload } = await jwtVerify(authorization.slice(7), googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: requireEnv("GOOGLE_PUBSUB_AUDIENCE"),
    algorithms: ["RS256"],
  });
  if (
    payload.email !== requireEnv("GOOGLE_PUBSUB_SERVICE_EMAIL") ||
    payload.email_verified !== true
  ) throw new Error("invalid_signature");
}
async function googleAccess(): Promise<string> {
  const creds = record(
    JSON.parse(requireEnv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON")),
  );
  if (
    typeof creds.client_email !== "string" ||
    typeof creds.private_key !== "string"
  ) throw new Error("not_configured");
  const key = await importPKCS8(creds.private_key, "RS256");
  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/androidpublisher",
  }).setProtectedHeader({ alg: "RS256" }).setIssuer(creds.client_email)
    .setAudience("https://oauth2.googleapis.com/token").setIssuedAt()
    .setExpirationTime("5m").sign(key);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = record(
    await providerJson("https://oauth2.googleapis.com/token", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  );
  if (typeof response.access_token !== "string") {
    throw new Error("provider_unavailable");
  }
  return response.access_token;
}
export async function verifyGooglePurchase(
  token: string,
  userId: string,
): Promise<
  { subscription: Subscription; raw: Record<string, unknown>; hash: string }
> {
  const access = await googleAccess();
  const pkg = requireEnv("GOOGLE_PLAY_PACKAGE");
  const raw = record(
    await providerJson(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${
        encodeURIComponent(pkg)
      }/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`,
      { headers: { Authorization: `Bearer ${access}` } },
    ),
  );
  if (raw.testPurchase && env("BILLING_SANDBOX") !== "true") {
    throw new Error("test_purchase_rejected");
  }
  const hash = await digestId(token);
  return {
    subscription: normalizeGoogleSubscription(
      raw,
      await digestId(userId),
      hash,
      catalog(),
    ),
    raw,
    hash,
  };
}
export function appleServices() {
  const sandbox = env("BILLING_SANDBOX") === "true";
  const environment = sandbox ? Environment.SANDBOX : Environment.PRODUCTION;
  const bundleId = requireEnv("APPLE_BUNDLE_ID");
  const roots = requireEnv("APPLE_ROOT_CA_BASE64").split(",").map((value) =>
    Buffer.from(value.trim(), "base64")
  );
  const appAppleId = sandbox ? undefined : Number(requireEnv("APPLE_APP_ID"));
  if (!sandbox && (!Number.isSafeInteger(appAppleId) || !appAppleId)) {
    throw new Error("not_configured");
  }
  return {
    verifier: new SignedDataVerifier(
      roots,
      true,
      environment,
      bundleId,
      appAppleId,
    ),
    client: new AppStoreServerAPIClient(
      requireEnv("APPLE_PRIVATE_KEY").replaceAll("\\n", "\n"),
      requireEnv("APPLE_KEY_ID"),
      requireEnv("APPLE_ISSUER_ID"),
      bundleId,
      environment,
    ),
  };
}
async function deadline<T>(work:Promise<T>):Promise<T> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("provider_timeout")),25000);})]);}finally{clearTimeout(timer);}
}
export async function verifyApplePurchase(
  transactionId: string,
  userId: string,
): Promise<Subscription> {
  const { client, verifier } = appleServices();
  const response = await deadline(client.getAllSubscriptionStatuses(transactionId));
  const candidates: Subscription[] = [];
  for (const group of response.data ?? []) {
    for (const item of group.lastTransactions ?? []) {
      if (!item.signedTransactionInfo) {
        continue;
      }
      const tx = await deadline(verifier.verifyAndDecodeTransaction(
        item.signedTransactionInfo,
      ));
      if (tx.appAccountToken !== userId) continue;
      const renewal = item.signedRenewalInfo
        ? await deadline(verifier.verifyAndDecodeRenewalInfo(item.signedRenewalInfo))
        : {};
      candidates.push(
        normalizeAppleSubscription(tx, renewal, userId, catalog(), item.status),
      );
    }
  }
  if (!candidates.length) throw new Error("ownership_conflict");
  return candidates.sort((a, b) =>
    Date.parse(b.current_period_end) - Date.parse(a.current_period_end)
  )[0];
}
export async function paymongo(
  path: string,
  method = "GET",
  attributes?: unknown,
  key?: string,
): Promise<Record<string, unknown>> {
  if (
    !/^\/(?:customers|subscriptions|payment_methods|payment_intents|invoices|payments)(?:\/[A-Za-z0-9_-]+){0,3}$/
      .test(path)
  ) throw new Error("bad_provider_path");
  const result = record(
    await providerJson(`https://api.paymongo.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${requireEnv("PAYMONGO_SECRET_KEY")}:`)}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(attributes ? { body: JSON.stringify({ data: { attributes } }) } : {}),
    }),
  );
  return record(result.data);
}
export function webPrice(product: PaidProduct): number {
  return (product.tier === "plus" ? 249 : 599) *
    (product.interval === "annual" ? 10 : 1) * 100;
}
export async function checkWebPlan(product: PaidProduct): Promise<void> {
  const plan = record(
    (await paymongo(`/subscriptions/plans/${product.id}`)).attributes,
  );
  const annual = plan.interval === "year" || plan.interval === "yearly" ||
    ((plan.interval === "month" || plan.interval === "monthly") &&
      plan.interval_count === 12);
  if (
    plan.currency !== "PHP" || plan.amount !== webPrice(product) ||
    (product.interval === "annual"
      ? !annual
      : !["month", "monthly"].includes(String(plan.interval)) ||
        plan.interval_count !== 1) ||
    plan.type === "on_demand"
  ) throw new Error("invalid_plan_configuration");
}
export async function webSubscription(
  id: string,
  previous?: Subscription,
): Promise<
  {
    subscription: Subscription;
    customerId: string;
    updatedAt: string;
    invoiceId: string | null;
    paymentIntentId: string | null;
  }
> {
  const data = await paymongo(`/subscriptions/${id}`),
    a = record(data.attributes),
    plan = record(a.plan),
    invoice = record(a.latest_invoice);
  const product = catalog().find((p) =>
    p.provider === "web" && p.id === plan.id
  );
  if (
    !product || plan.amount !== webPrice(product) || plan.currency !== "PHP"
  ) throw new Error("unknown_product");
  const start = new Date(String(a.anchor_date)).toISOString(),
    end = new Date(String(a.next_billing_schedule)).toISOString();
  const paid = invoice.status === "paid" ||
    record(invoice.payment_intent).status === "succeeded";
  const previousPaidThrough = previous?.paid_through ?? start;
  const paidThrough = paid && invoice.id !== previous?.transaction_id
    ? end
    : previousPaidThrough;
  return {
    customerId: String(a.customer_id),
    paymentIntentId: typeof record(invoice.payment_intent).id === "string"
      ? String(record(invoice.payment_intent).id)
      : null,
    updatedAt: typeof a.updated_at === "number"
      ? new Date(a.updated_at * 1000).toISOString()
      : new Date().toISOString(),
    invoiceId: typeof invoice.id === "string" ? invoice.id : null,
    subscription: {
      external_id: id,
      product_id: previous && invoice.id === previous.transaction_id
        ? previous.product_id
        : product.id,
      tier: previous && invoice.id === previous.transaction_id
        ? previous.tier
        : product.tier,
      billing_interval: previous && invoice.id === previous.transaction_id
        ? previous.billing_interval
        : product.interval,
      current_period_start: start,
      current_period_end: end,
      paid_through: paidThrough,
      auto_renew: a.status !== "cancelled",
      transaction_id: typeof invoice.id === "string" ? invoice.id : null,
      status:
        previous?.status === "revoked" && invoice.id === previous.transaction_id
          ? "revoked"
          : a.status === "cancelled"
          ? "cancelled"
          : paid && a.status === "active"
          ? "active"
          : a.status === "past_due" && Date.parse(paidThrough) > Date.now()
          ? "grace"
          : "expired",
    },
  };
}
export async function attachMaya(
  subscription: Record<string, unknown>,
  name: string,
  email: string,
  requestId: string,
): Promise<string> {
  const a = record(subscription.attributes),
    invoice = record(a.latest_invoice),
    intent = record(invoice.payment_intent);
  if (typeof intent.id !== "string") throw new Error("provider_unavailable");
  const payment = await paymongo("/payment_methods", "POST", {
    type: "paymaya",
    billing: { name, email },
  }, `${requestId}:payment`);
  const origin = new URL(requireEnv("BILLING_SITE_ORIGIN"));
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.pathname !== "/"
  ) throw new Error("invalid_origin");
  const result = await paymongo(
    `/payment_intents/${intent.id}/attach`,
    "POST",
    { payment_method: payment.id, return_url: `${origin.origin}/plans` },
    `${requestId}:attach`,
  );
  const next = record(record(record(result.attributes).next_action).redirect);
  const url = safeCheckoutUrl(next.url);
  if (!url) throw new Error("unsafe_checkout");
  return url;
}
