import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Radii } from "@/src/styles/colors";
import { BeeAction } from "@/src/components/ai/BeeMemories";
import { BeeMascot } from "@/src/components/ai/BeeGuide";
import {
  type BillingCatalog,
  billingRequest,
  type BillingStatus,
} from "@/src/lib/billing";
import { connectStore, type StoreProduct } from "@/src/lib/nativeBilling";
import { createBeeRequestId } from "@/src/lib/beeChat";
import { supabase } from "@/src/lib/supabase";
import { PageMetadata } from "@/src/components/legal/PageMetadata";
const copy = {
  basic:
    "Manual food and weight tracking, goals, barcode search, personal foods and recipes.",
  plus:
    "60 food help requests and 10 live Search queries each month. One food at a time; no adaptive chat.",
  pro:
    "250 Bee interactions, 50 live Search queries and 30 dashboard insights each month. Adaptive chat, preferences, weight guidance and reviewed goal suggestions.",
};
export default function Plans() {
  const router = useRouter();
  const [status, setStatus] = useState<BillingStatus | null>(null),
    [catalog, setCatalog] = useState<BillingCatalog | null>(null),
    [products, setProducts] = useState<StoreProduct[]>([]),
    [interval, setInterval] = useState<"monthly" | "annual">("monthly"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [first, setFirst] = useState(""),
    [last, setLast] = useState(""),
    [review, setReview] = useState<"plus" | "pro" | null>(null),
    [notice, setNotice] = useState("");
  const store = useRef<Awaited<ReturnType<typeof connectStore>> | null>(null),
    owner = useRef<string | null>(null),
    checkout = useRef<
      {
        tier: "plus" | "pro";
        interval: "monthly" | "annual";
        id: string;
        first: string;
        last: string;
      } | null
    >(null),
    epoch = useRef(0);
  const refresh = useCallback(async () => {
    const turn = epoch.current;
    try {
      const result = await billingRequest<BillingStatus>({ action: "status" });
      if (turn === epoch.current) setStatus(result);
    } catch {
      if (turn === epoch.current) {
        setError("Could not refresh your plan. Try again.");
      }
    }
  }, []);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        owner.current = session.user.id;
        const [s, c] = await Promise.all([
          billingRequest<BillingStatus>({ action: "status" }, session.user.id),
          billingRequest<BillingCatalog>(
            { action: "catalog" },
            session.user.id,
          ),
        ]);
        if (!active) return;
        setStatus(s);
        setCatalog(c);
        if (Platform.OS !== "web") {
          const connected = await connectStore(
            c,
            session.user.id,
            () => void refresh(),
            (message) => {
              if (active) setError(message);
            },
          );
          if (!active) {
            connected.dispose();
            return;
          }
          store.current = connected;
          setProducts(connected.products);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : "Plans are unavailable.");
        }
      }
    })();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (owner.current && session?.user.id !== owner.current) {
        epoch.current++;
        owner.current = null;
        store.current?.dispose();
        store.current = null;
        setStatus(null);
        setCatalog(null);
        setProducts([]);
        checkout.current = null;
        setError("Account changed. Reopen Plans for this account.");
      }
    });
    return () => {
      active = false;
      // Advance this request epoch to reject late replies after unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      data.subscription.unsubscribe();
      store.current?.dispose();
    };
  }, [refresh]);
  const action = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Purchase could not finish. Retry or restore.",
      );
    } finally {
      setBusy(false);
    }
  };
  const buy = async (tier: "plus" | "pro") => {
    if (!catalog || !owner.current) return;
    await action(async () => {
      if (Platform.OS === "web") {
        const existing = status?.subscriptions.find(s => s.provider === "web" && ["active", "cancelled", "grace"].includes(s.status) && Date.parse(s.paid_through) > Date.now());
        if (existing) {
          const result = await billingRequest<{message: string}>({action:"web_change_plan",subscription_id:existing.id,tier,interval},owner.current!);
          setNotice(result.message); setReview(null); await refresh(); return;
        }
        if (!first.trim() || !last.trim()) {
          throw new Error("Enter the billing first and last name.");
        }
        const saved = checkout.current;
        const request =
          saved && saved.tier === tier && saved.interval === interval
            ? saved
            : {
              tier,
              interval,
              id: createBeeRequestId(),
              first: first.trim(),
              last: last.trim(),
            };
        checkout.current = request;
        const result = await billingRequest<{ checkout_url: string }>({
          action: "web_checkout",
          tier,
          interval,
          request_id: request.id,
          first_name: request.first,
          last_name: request.last,
        }, owner.current!);
        const url = new URL(result.checkout_url);
        if (
          url.protocol !== "https:" ||
          ![
            "payments.paymaya.com",
            "payments.maya.ph",
            "checkout.paymongo.com",
            "pm.link",
          ].includes(url.hostname)
        ) throw new Error("Payment link is unavailable.");
        await Linking.openURL(url.href);
      } else {
        const definition = catalog.products.find((p) =>
          p.provider === (Platform.OS === "ios" ? "apple" : "google") &&
          p.tier === tier && p.interval === interval
        );
        const product = products.find((p) =>
          p.id === definition?.id &&
          (!definition?.basePlan || p.basePlan === definition.basePlan)
        );
        if (!product || !store.current) {
          throw new Error("Store price is unavailable.");
        }
        await store.current.buy(product);
        setReview(null);
      }
    });
  };
  return (
    <SafeAreaView style={styles.screen}>
      <PageMetadata privateAccount />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <BeeAction label="Back" onPress={() => router.back()} />
        <BeeMascot situation="greeting" />
        <Text accessibilityRole="header" style={styles.title}>
          Choose your plan
        </Text>
        <Text style={styles.copy}>
          Manual tracking stays free. Paid plans unlock limited AI help on your
          one account across web, iOS and Android.
        </Text>
        <Text style={styles.copy}>
          Current plan: {status?.entitlement.tier ?? "Loading…"}
        </Text>
        {status?.entitlement.duplicate_subscriptions
          ? (
            <Text style={styles.warning}>
              More than one subscription is active. Your highest tier applies;
              manage duplicate subscriptions to avoid paying twice.
            </Text>
          )
          : null}
        <View style={styles.row}>
          <BeeAction
            label="Monthly"
            primary={interval === "monthly"}
            disabled={busy}
            onPress={() => setInterval("monthly")}
          />
          <BeeAction
            label="Yearly"
            primary={interval === "annual"}
            disabled={busy}
            onPress={() => setInterval("annual")}
          />
        </View>
        {(["basic", "plus", "pro"] as const).map((tier) => {
          const definition = catalog?.products.find((p) =>
            p.provider === (Platform.OS === "ios"
                ? "apple"
                : Platform.OS === "android"
                ? "google"
                : "web") && p.tier === tier && p.interval === interval
          );
          const price = Platform.OS === "web"
            ? tier === "basic"
              ? "Free"
              : `₱${
                tier === "plus"
                  ? (interval === "annual" ? "2,490/year" : "249/month")
                  : (interval === "annual" ? "5,990/year" : "599/month")
              }`
            : tier === "basic"
            ? "Free"
            : products.find((p) =>
              p.id === definition?.id &&
              (!definition?.basePlan || p.basePlan === definition.basePlan)
            )?.price ?? "Store price unavailable";
          return (
            <View key={tier} style={styles.card}>
              <Text style={styles.heading}>
                {tier.charAt(0).toUpperCase() + tier.slice(1)} · {price}
              </Text>
              <Text style={styles.copy}>{copy[tier]}</Text>
              {tier !== "basic"
                ? (
                  <>
                    <Text style={styles.copy}>
                      Monthly token fair use: {tier === "plus"
                        ? "160,000 input / 50,000 output"
                        : "800,000 input / 200,000 output"}. Long messages can
                      use this allowance before your request limit. No overage
                      charges.
                    </Text>
                    <BeeAction
                      label={`Review ${tier}`}
                      primary
                      disabled={busy || !catalog ||
                        (Platform.OS === "web" && !catalog.web_enabled) ||
                        !status || status.subscriptions.some(s => s.provider !== (Platform.OS === "ios" ? "apple" : Platform.OS === "android" ? "google" : "web") && ["active","cancelled","grace"].includes(s.status) && Date.parse(s.paid_through) > Date.now())}
                      onPress={() => setReview(tier)}
                    />
                  </>
                )
                : null}
            </View>
          );
        })}
        {review ? <View style={styles.card}>
          <Text style={styles.heading}>Review {review} · {interval === "annual" ? "yearly" : "monthly"}</Text>
          <Text style={styles.copy}>This subscription renews automatically. Review the exact price on the card above and the provider’s payment sheet. Existing web plan changes take effect at the next paid cycle; store changes follow the store’s displayed schedule.</Text>
          <View style={styles.row}><BeeAction label="Continue to payment" primary disabled={busy} onPress={() => void buy(review)} /><BeeAction label="Cancel" disabled={busy} onPress={() => setReview(null)} /></View>
        </View> : null}
        {notice ? <Text accessibilityRole="alert" style={styles.copy}>{notice}</Text> : null}
        {Platform.OS === "web"
          ? (
            <View style={styles.card}>
              <Text style={styles.copy}>
                Recurring web checkout uses Maya when configured. Card checkout
                and GCash are not offered here.
              </Text>
              <TextInput
                accessibilityLabel="Billing first name"
                maxLength={60}
                value={first}
                onChangeText={setFirst}
                placeholder="First name"
                placeholderTextColor={Colors.textSecondary}
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Billing last name"
                maxLength={60}
                value={last}
                onChangeText={setLast}
                placeholder="Last name"
                placeholderTextColor={Colors.textSecondary}
                style={styles.input}
              />
            </View>
          )
          : (
            <View style={styles.row}>
              <BeeAction
                label="Restore purchases"
                disabled={busy || !store.current}
                onPress={() =>
                  void action(async () => {
                    await store.current?.restore();
                    await refresh();
                  })}
              />
              <BeeAction
                label="Manage store subscription"
                disabled={busy || !store.current}
                onPress={() =>
                  void action(async () => {
                    await store.current?.manage();
                  })}
              />
            </View>
          )}
        <Text style={styles.copy}>
          Paid subscriptions renew automatically until cancelled through the
          original provider. Cancellation retains already-paid access. Annual
          plans receive a fresh allowance each month, with no yearly lump sum.
        </Text>
        {status
          ? (
            <View style={styles.card}>
              <Text style={styles.heading}>This month</Text>
              {Object.entries(status.entitlement.remaining).map((
                [key, value],
              ) => (
                <Text key={key} style={styles.copy}>
                  {key.replaceAll("_", " ")}: {value.toLocaleString()}{" "}
                  remaining of{" "}
                  {status.entitlement.limits[key]?.toLocaleString()}
                </Text>
              ))}
              <Text style={styles.copy}>
                Resets: {status.entitlement.reset_at
                  ? new Date(status.entitlement.reset_at).toLocaleString()
                  : "After a verified subscription begins"}
              </Text>
              {status.subscriptions.map((s) => (
                <View key={s.id}>
                  <Text style={styles.copy}>
                    {s.provider} · {s.status} · Paid through{" "}
                    {new Date(s.paid_through).toLocaleDateString()}
                  </Text>
                  {s.provider === "web" && Platform.OS === "web" && s.auto_renew
                    ? (
                      <BeeAction
                        label="Cancel renewal"
                        disabled={busy}
                        onPress={() =>
                          void action(async () => {
                            await billingRequest({
                              action: "web_cancel",
                              subscription_id: s.id,
                            }, owner.current ?? undefined);
                            await refresh();
                          })}
                      />
                    )
                    : null}
                </View>
              ))}
            </View>
          )
          : null}
        <BeeAction
          label="Refresh plan"
          disabled={busy}
          onPress={() => void refresh()}
        />
        <BeeAction
          label="Manual tracking"
          onPress={() => router.push("/(tabs)/add")}
        />
        {busy ? <ActivityIndicator color={Colors.accent} /> : null}
        {error
          ? (
            <Text accessibilityRole="alert" style={styles.warning}>
              {error}
            </Text>
          )
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.primary },
  content: {
    maxWidth: 760,
    width: "100%",
    alignSelf: "center",
    padding: 24,
    gap: 18,
  },
  title: { color: Colors.text, fontSize: 28, fontWeight: "700" },
  heading: { color: Colors.text, fontSize: 20, fontWeight: "600" },
  copy: { color: Colors.textSecondary, fontSize: 15, lineHeight: 23 },
  warning: { color: Colors.error, fontSize: 15, lineHeight: 23 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.card,
    padding: 20,
    gap: 14,
  },
  input: {
    borderColor: Colors.controlBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    minHeight: 44,
    color: Colors.text,
  },
});
