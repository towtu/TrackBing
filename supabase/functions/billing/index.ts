import { createClient } from "jsr:@supabase/supabase-js@2";
import { readBoundedRequestJson } from "../_shared/beeRequest.ts";
import { requestFingerprint } from "../_shared/beeService.ts";
import { digestId, parseBillingCommand } from "../_shared/billingProtocol.ts";
import {
  attachMaya,
  catalog,
  checkWebPlan,
  env,
  paymongo,
  verifyApplePurchase,
  verifyGooglePurchase,
  webSubscription,
} from "../_shared/billingProviders.ts";
import { billingStore } from "../_shared/billingStore.ts";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,x-client-info,content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  const authorization = req.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/i.test(authorization) || authorization.length > 8192) {
    return json({ error: "unauthorized" }, 401);
  }
  const url = env("SUPABASE_URL"),
    anon = env("SUPABASE_ANON_KEY"),
    secret = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !secret) return json({ error: "not_configured" }, 503);
  const client = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  let command;
  try {
    command = parseBillingCommand(await readBoundedRequestJson(req));
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const admin = createClient(url, secret, { auth: { persistSession: false } }),
    store = billingStore(admin);
  const userId = user.id;
  try {
    if (command.action === "status") {
      const entitlement = await store.rpc("resolve_entitlement", {
        p_user: userId,
      });
      const { data, error } = await admin.from("subscriptions").select(
        "id,provider,tier,status,paid_through,auto_renew,billing_interval,product_id,external_id",
      ).eq("user_id", userId).order("updated_at", { ascending: false }).limit(
        10,
      );
      if (error) throw new Error("database_error");
      return json({
        ok: true,
        entitlement,
        subscriptions: (data ?? []).map(({ external_id: _, ...row }) => row),
      });
    }
    if (command.action === "catalog") {
      const products = catalog();
      const ownerHash = await digestId(userId);
      await store.bind("apple", userId, userId);
      await store.bind("google", ownerHash, userId);
      return json({
        ok: true,
        products,
        apple_account_token: userId,
        google_account_id: ownerHash,
        web_enabled: env("PAYMONGO_ENABLED") === "true",
        sandbox: env("BILLING_SANDBOX") === "true",
      });
    }
    const requestId = command.action === "web_checkout"
      ? command.request_id
      : crypto.randomUUID();
    const token = crypto.randomUUID();
    const begin = await store.rpc<
      { ok: boolean; replay?: boolean; result?: unknown; error?: string }
    >("begin_billing_request", {
      p_user: userId,
      p_request: requestId,
      p_fingerprint: await requestFingerprint(command),
      p_token: token,
    });
    if (!begin.ok) {
      return json(begin, begin.error === "rate_limited" ? 429 : 409);
    }
    if (begin.replay) return json(begin.result);
    let result: unknown;
    if (command.action === "verify_google") {
      const verified = await verifyGooglePurchase(command.token, userId);
      await store.bind("google", await digestId(userId), userId);
      const { error } = await admin.from("billing_purchase_credentials").upsert(
        {
          provider: "google",
          external_id: verified.hash,
          user_id: userId,
          purchase_token: command.token,
        },
        { onConflict: "provider,external_id" },
      );
      if (error) throw new Error("database_error");
      result = await store.reconcile(
        "google",
        crypto.randomUUID(),
        new Date().toISOString(),
        userId,
        verified.subscription,
      );
      if (
        typeof verified.raw.linkedPurchaseToken === "string" &&
        verified.raw.linkedPurchaseToken.length <= 2048
      ) {
        const old = await verifyGooglePurchase(
          verified.raw.linkedPurchaseToken,
          userId,
        );
        await store.reconcile(
          "google",
          crypto.randomUUID(),
          new Date().toISOString(),
          userId,
          old.subscription,
        );
      }
    } else if (command.action === "verify_apple") {
      const subscription = await verifyApplePurchase(
        command.transaction_id,
        userId,
      );
      await store.bind("apple", userId, userId);
      result = await store.reconcile(
        "apple",
        crypto.randomUUID(),
        new Date().toISOString(),
        userId,
        subscription,
      );
    } else if (command.action === "web_change_plan") {
      const { data: existing, error } = await admin.from("subscriptions")
        .select("external_id").eq("user_id", userId).eq(
          "id",
          command.subscription_id,
        ).eq("provider", "web").single();
      if (error || !existing) return json({ error: "not_found" }, 404);
      const product = catalog().find((p) =>
        p.provider === "web" && p.tier === command.tier &&
        p.interval === command.interval
      );
      if (!product) throw new Error("not_configured");
      await checkWebPlan(product);
      await paymongo(`/subscriptions/${existing.external_id}/plan`, "PUT", {
        plan_id: product.id,
      });
      result = {
        ok: true,
        message:
          "Plan change requested for the next paid cycle. Your current paid access stays until then.",
      };
    } else if (command.action === "web_cancel") {
      const { data, error } = await admin.from("subscriptions").select(
        "*",
      ).eq("user_id", userId).eq("id", command.subscription_id).eq(
        "provider",
        "web",
      ).single();
      if (error || !data) return json({ error: "not_found" }, 404);
      await paymongo(`/subscriptions/${data.external_id}`, "DELETE");
      const fresh = await webSubscription(data.external_id, data);
      result = await store.reconcile(
        "web",
        crypto.randomUUID(),
        new Date().toISOString(),
        userId,
        {
          ...fresh.subscription,
          status: "cancelled",
          auto_renew: false,
          paid_through: data.paid_through,
        },
      );
    } else {
      if (env("PAYMONGO_ENABLED") !== "true") throw new Error("not_configured");
      const { data: profile } = await admin.from("user_goals").select("age").eq(
        "user_id",
        userId,
      ).maybeSingle();
      if (typeof profile?.age !== "number" || profile.age < 18) {
        return json({ error: "age_restricted" }, 403);
      }
      const entitlement = await store.rpc<{ tier: string }>(
        "resolve_entitlement",
        { p_user: userId },
      );
      if (entitlement.tier !== "basic") {
        return json({ error: "already_subscribed" }, 409);
      }
      const product = catalog().find((p) =>
        p.provider === "web" && p.tier === command.tier &&
        p.interval === command.interval
      );
      if (!product) throw new Error("not_configured");
      await checkWebPlan(product);
      const { data: existing } = await admin.from("billing_web_checkouts")
        .select("external_id,customer_id,product_id").eq("user_id", userId).eq(
          "request_id",
          requestId,
        ).maybeSingle();
      let subscription;
      if (existing) {
        if (existing.product_id !== product.id) throw new Error("conflict");
        subscription = await paymongo(`/subscriptions/${existing.external_id}`);
      } else {
        // Avoid another incomplete recurring checkout on this account; retry its original request instead.
        const { data: pending } = await admin.from("billing_web_checkouts")
          .select("request_id").eq("user_id", userId).gt(
            "created_at",
            new Date(Date.now() - 86400000).toISOString(),
          ).limit(1);
        if (pending?.length) return json({ error: "checkout_pending" }, 409);
        const { data: customer } = await admin.from("billing_web_customers")
          .select("customer_id").eq("user_id", userId).maybeSingle();
        let customerId = customer?.customer_id;
        if (!customerId) {
          const created = await paymongo("/customers", "POST", {
            first_name: command.first_name,
            last_name: command.last_name,
            email: user.email,
          }, `${requestId}:customer`);
          if (typeof created.id !== "string") {
            throw new Error("provider_unavailable");
          }
          customerId = created.id;
          const { error } = await admin.from("billing_web_customers").insert({
            user_id: userId,
            customer_id: customerId,
          });
          if (error) throw new Error("database_error");
        }
        subscription = await paymongo("/subscriptions", "POST", {
          plan_id: product.id,
          customer_id: customerId,
        }, `${requestId}:subscription`);
        if (typeof subscription.id !== "string") {
          throw new Error("provider_unavailable");
        }
        const { error } = await admin.from("billing_web_checkouts").insert({
          user_id: userId,
          request_id: requestId,
          external_id: subscription.id,
          customer_id: customerId,
          product_id: product.id,
        });
        if (error) throw new Error("database_error");
      }
      result = {
        ok: true,
        checkout_url: await attachMaya(
          subscription,
          `${command.first_name} ${command.last_name}`,
          user.email ?? "",
          requestId,
        ),
      };
    }
    await store.rpc("finish_billing_request", {
      p_user: userId,
      p_request: requestId,
      p_token: token,
      p_result: result,
    });
    return json(result);
  } catch (error) {
    const known = error instanceof Error ? error.message : "";
    const code = [
        "not_configured",
        "ownership_conflict",
        "unknown_product",
        "invalid_plan_configuration",
        "test_purchase_rejected",
        "conflict",
        "unsafe_checkout",
      ].includes(known)
      ? known
      : "provider_unavailable";
    console.error("billing_failure", { code });
    return json({ error: code }, code === "ownership_conflict" ? 403 : 503);
  }
});
