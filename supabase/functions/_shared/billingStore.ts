import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Subscription } from "./billingProtocol.ts";
export function billingStore(admin: SupabaseClient) {
  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error("database_error");
    return data as T;
  }
  return {
    rpc,
    async reconcile(
      provider: string,
      eventId: string,
      eventAt: string,
      userId: string,
      subscription: Subscription,
    ) {
      const result = await rpc<{ ok: boolean; error?: string }>(
        "reconcile_subscription",
        {
          p_provider: provider,
          p_event_id: eventId,
          p_event_at: eventAt,
          p_user: userId,
          p_subscription: subscription,
        },
      );
      if (!result.ok) throw new Error(result.error ?? "reconciliation_failed");
      return result;
    },
    async binding(provider: string, token: string) {
      const { data, error } = await admin.from("billing_provider_bindings")
        .select("user_id").eq("provider", provider).eq("account_token", token)
        .maybeSingle();
      if (error) throw new Error("database_error");
      return data?.user_id as string | undefined;
    },
    async bind(provider: string, token: string, userId: string) {
      const { error } = await admin.from("billing_provider_bindings").upsert({
        provider,
        account_token: token,
        user_id: userId,
      }, { onConflict: "provider,user_id" });
      if (error) throw new Error("binding_failed");
    },
    async webOwner(id: string) {
      const { data, error } = await admin.from("billing_web_checkouts").select(
        "user_id",
      ).eq("external_id", id).maybeSingle();
      if (error) throw new Error("database_error");
      return data?.user_id as string | undefined;
    },
  };
}
