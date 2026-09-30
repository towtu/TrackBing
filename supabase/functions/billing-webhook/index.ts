import { createClient } from "jsr:@supabase/supabase-js@2";
import { record } from "../_shared/beeIntent.ts";
import {
  readBoundedRequestJson,
  readBoundedRequestText,
} from "../_shared/beeRequest.ts";
import {
  digestId,
  verifyPayMongoSignature,
} from "../_shared/billingProtocol.ts";
import {
  appleServices,
  env,
  paymongo,
  verifyApplePurchase,
  verifyGooglePurchase,
  verifyGooglePush,
  webSubscription,
} from "../_shared/billingProviders.ts";
import { billingStore } from "../_shared/billingStore.ts";
Deno.serve(async (req: Request) => {
  const reply = (status: number) =>
    new Response(JSON.stringify({ ok: status === 200 }), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  if (req.method !== "POST") return reply(405);
  const url = env("SUPABASE_URL"), secret = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) return reply(503);
  const admin = createClient(url, secret, { auth: { persistSession: false } }),
    store = billingStore(admin);
  const provider = new URL(req.url).searchParams.get("provider");
  try {
    if (provider === "web") {
      const raw = await readBoundedRequestText(req, 100000); // Exact original JSON bytes, before parsing.
      if (
        !await verifyPayMongoSignature(
          raw,
          req.headers.get("Paymongo-Signature") ?? "",
          env("PAYMONGO_WEBHOOK_SECRET"),
          env("PAYMONGO_LIVE") === "true",
        )
      ) return reply(401);
      const data = record(record(JSON.parse(raw)).data),
        event = record(data.attributes);
      if (
        event.livemode !== (env("PAYMONGO_LIVE") === "true") ||
        typeof data.id !== "string"
      ) return reply(401);
      const resource = record(event.data),
        attributes = record(resource.attributes);
      const sensitive = typeof event.type === "string" &&
        /refund|dispute/.test(event.type);
      const paymentId = resource.type === "payment"
        ? resource.id
        : attributes.payment_id;
      let link: {
        user_id: string;
        external_id: string;
        invoice_id: string;
        payment_intent_id: string;
      } | null = null;
      if (sensitive && typeof paymentId === "string") {
        const { data, error } = await admin.from("billing_web_payment_links")
          .select("user_id,external_id,invoice_id,payment_intent_id").eq(
            "payment_id",
            paymentId,
          ).maybeSingle();
        if (error) throw new Error("database_error");
        link = data;
        if (!link) throw new Error("payment_reconciliation_required"); // Retry, do not silently acknowledge an unmapped refund.
      }
      let id = link?.external_id ??
        (resource.type === "subscription"
          ? resource.id
          : record(attributes.subscription ?? {}).id);
      if (!id && resource.type === "payment") {
        const intent = attributes.payment_intent_id;
        if (typeof intent === "string") {
          const fetched = await paymongo(`/payment_intents/${intent}`);
          id = record(record(fetched.attributes).subscription ?? {}).id;
        }
      }
      if (typeof id !== "string") return reply(200);
      const owner = link?.user_id ?? await store.webOwner(id);
      if (!owner) return reply(200);
      const { data: prior, error: priorError } = await admin.from(
        "subscriptions",
      ).select("*").eq("user_id", owner).eq("provider", "web").eq(
        "external_id",
        id,
      ).maybeSingle();
      if (priorError) throw new Error("database_error");
      const fresh = await webSubscription(id, prior ?? undefined);
      if (fresh.paymentIntentId && fresh.invoiceId) {
        const pi = await paymongo(`/payment_intents/${fresh.paymentIntentId}`);
        const payments = record(pi.attributes).payments;
        if (Array.isArray(payments)) {
          for (const rawPayment of payments.slice(0, 5)) {
            const payment = record(rawPayment);
            if (typeof payment.id !== "string") {
              continue;
            }
            const { error } = await admin.from("billing_web_payment_links")
              .upsert({
                payment_id: payment.id,
                user_id: owner,
                external_id: id,
                invoice_id: fresh.invoiceId,
                payment_intent_id: fresh.paymentIntentId,
              }, { onConflict: "payment_id" });
            if (error) throw new Error("database_error");
          }
        }
      }
      if (sensitive) {
        if (!link || link.invoice_id !== fresh.invoiceId) return reply(200); // An older refunded cycle cannot revoke a later paid cycle.
        if (resource.type === "refund") {
          if (attributes.status !== "succeeded") return reply(200);
          const payment = record(
            (await paymongo(`/payments/${String(paymentId)}`)).attributes,
          );
          const refunds = payment.refunds;
          const total = Array.isArray(refunds)
            ? refunds.reduce((sum: number, r: unknown) => {
              const x = record(r);
              const a = record(x.attributes ?? x);
              return sum +
                (a.status === "succeeded" && typeof a.amount === "number"
                  ? a.amount
                  : 0);
            }, 0)
            : Number(attributes.amount);
          if (
            !Number.isFinite(total) || typeof payment.amount !== "number" ||
            total < payment.amount
          ) return reply(200);
        }
        fresh.subscription.status = "revoked";
      }
      await store.reconcile(
        "web",
        data.id,
        new Date().toISOString(),
        owner,
        fresh.subscription,
      );
      return reply(200);
    }
    if (provider === "google") {
      await verifyGooglePush(req.headers.get("authorization") ?? "");
      const body = record(await readBoundedRequestJson(req));
      const message = record(body.message);
      if (
        typeof message.data !== "string" || message.data.length > 20000 ||
        typeof message.messageId !== "string"
      ) return reply(400);
      const payload = record(JSON.parse(atob(message.data)));
      if (payload.packageName !== env("GOOGLE_PLAY_PACKAGE")) return reply(401);
      if (payload.testNotification) return reply(200);
      const notification = record(payload.subscriptionNotification);
      if (
        typeof notification.purchaseToken !== "string" ||
        notification.purchaseToken.length > 2048
      ) return reply(400);
      const hash = await digestId(notification.purchaseToken);
      const { data: credential } = await admin.from(
        "billing_purchase_credentials",
      ).select("user_id").eq("provider", "google").eq("external_id", hash)
        .maybeSingle();
      let owner = credential?.user_id;
      if (!owner) return reply(200);
      const fresh = await verifyGooglePurchase(
        notification.purchaseToken,
        owner,
      );
      await store.reconcile(
        "google",
        message.messageId,
        new Date().toISOString(),
        owner,
        fresh.subscription,
      );
      if (
        typeof fresh.raw.linkedPurchaseToken === "string" &&
        fresh.raw.linkedPurchaseToken.length <= 2048
      ) {
        const old = await verifyGooglePurchase(
          fresh.raw.linkedPurchaseToken,
          owner,
        );
        await store.reconcile(
          "google",
          crypto.randomUUID(),
          new Date().toISOString(),
          owner,
          old.subscription,
        );
      }
      return reply(200);
    }
    if (provider === "apple") {
      const body = record(await readBoundedRequestJson(req, 100000));
      if (
        typeof body.signedPayload !== "string" ||
        body.signedPayload.length > 90000
      ) return reply(400);
      const { verifier } = appleServices();
      const event = await verifier.verifyAndDecodeNotification(
        body.signedPayload,
      );
      if (event.notificationType === "TEST") return reply(200);
      if (!event.notificationUUID || !event.data?.signedTransactionInfo) {
        return reply(400);
      }
      const tx = await verifier.verifyAndDecodeTransaction(
        event.data.signedTransactionInfo,
      );
      if (!tx.appAccountToken || !tx.originalTransactionId) return reply(400);
      const owner = await store.binding("apple", tx.appAccountToken);
      if (!owner) return reply(200);
      const fresh = await verifyApplePurchase(tx.originalTransactionId, owner);
      await store.reconcile(
        "apple",
        event.notificationUUID,
        new Date().toISOString(),
        owner,
        fresh,
      );
      return reply(200);
    }
    return reply(400);
  } catch {
    console.error("billing_webhook_failure", {
      provider:
        provider === "web" || provider === "apple" || provider === "google"
          ? provider
          : "invalid",
    });
    return reply(503);
  }
});
