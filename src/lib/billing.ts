import { supabase } from "./supabase";
import type { BeeEntitlement } from "../../supabase/functions/_shared/beeTypes";
import type {
  BillingCommand,
  PaidProduct,
} from "../../supabase/functions/_shared/billingProtocol";
export type BillingStatus = {
  entitlement: BeeEntitlement & { duplicate_subscriptions?: boolean };
  subscriptions: {
    id: string;
    provider: "web" | "apple" | "google" | "legacy";
    tier: "plus" | "pro";
    status: string;
    paid_through: string;
    auto_renew: boolean;
    product_id: string;
    billing_interval: string;
  }[];
};
export type BillingCatalog = {
  products: PaidProduct[];
  apple_account_token: string;
  google_account_id: string;
  web_enabled: boolean;
  sandbox: boolean;
};
/** Account-bound requests: a refreshed session cannot attach a purchase to a switched account. */
export async function billingRequest<T>(
  command: BillingCommand,
  owner?: string,
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || owner && session.user.id !== owner) {
    throw new Error("Sign in to the account used for this purchase.");
  }
  const { data, error } = await supabase.functions.invoke("billing", {
    body: command,
    headers: { Authorization: `Bearer ${session.access_token}` },
    timeout: 75000,
  });
  let body = data;
  if (!body && error?.context instanceof Response) {
    try {
      body = await error.context.json();
    } catch {
      throw new Error("Billing is unavailable. Try again.");
    }
  }
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== session.user.id) {
    throw new Error(
      "Account changed. Restore from the account used for this purchase.",
    );
  }
  if (!body || body.ok !== true) throw new Error(billingError(body?.error));
  return body as T;
}
export function billingError(code: unknown): string {
  return ({
    not_configured:
      "Purchases are awaiting store configuration. Manual tracking is free.",
    ownership_conflict: "This purchase belongs to another TrackBing account.",
    already_subscribed:
      "You already have paid access. Manage its existing subscription before buying another.",
    checkout_pending:
      "A checkout is already open. Retry the original checkout or wait for it to expire.",
    age_restricted:
      "Paid AI features are available to adults with an age saved in Profile.",
    unknown_product: "That store product is not configured for TrackBing.",
    provider_unavailable:
      "The purchase could not be verified yet. Retry or restore purchases; access is granted only after verification.",
    busy: "A billing request is still processing. Retry shortly.",
    rate_limited: "Too many billing requests. Try again in a minute.",
    reconciliation_required:
      "This checkout needs reconciliation. Refresh your plan and contact support before retrying payment.",
  } as Record<string, string>)[String(code)] ??
    "Billing could not finish. Your manual tracking and saved data remain available.";
}
