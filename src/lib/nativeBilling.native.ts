import { Platform } from "react-native";
import * as IAP from "expo-iap";
import { type BillingCatalog, billingRequest } from "./billing";
import type { StoreProduct } from "./nativeBilling.web";
export type { StoreProduct } from "./nativeBilling.web";
export async function connectStore(
  catalog: BillingCatalog,
  owner: string,
  onVerified: () => void,
  onError: (message: string) => void = () => {},
): Promise<
  {
    products: StoreProduct[];
    buy: (product: StoreProduct) => Promise<void>;
    restore: () => Promise<void>;
    manage: () => Promise<void>;
    dispose: () => void;
  }
> {
  let active = true;
  const verifying = new Set<string>();
  const provider = Platform.OS === "ios" ? "apple" : "google";
  const configured = catalog.products.filter((p) => p.provider === provider);
  if (!configured.length) {
    throw new Error(
      "Store products are awaiting configuration. Manual tracking stays free.",
    );
  }
  if (!await IAP.initConnection()) {
    throw new Error(
      "The store is unavailable. Use a development or store build; purchases are unavailable in Expo Go.",
    );
  }
  const verify = async (purchase: IAP.Purchase) => {
    if (
      !active || purchase.purchaseState !== "purchased" ||
      !configured.some((p) => p.id === purchase.productId)
    ) return;
    const key = Platform.OS === "ios" ? purchase.id : purchase.purchaseToken;
    if (!key || verifying.has(key)) return;
    verifying.add(key);
    try {
      await billingRequest(
        Platform.OS === "ios"
          ? { action: "verify_apple", transaction_id: purchase.id }
          : { action: "verify_google", token: purchase.purchaseToken! },
        owner,
      );
      if (!active) return;
      await IAP.finishTransaction({ purchase, isConsumable: false });
      onVerified();
    } finally {
      verifying.delete(key);
    }
  };
  const listener = IAP.purchaseUpdatedListener((purchase) => {
    void verify(purchase).catch(() =>
      onError(
        "Purchase is not yet verified. Retry Restore purchases from this account.",
      )
    );
  });
  const raw = await IAP.fetchProducts({
    skus: [...new Set(configured.map((p) => p.id))],
    type: "subs",
  });
  const products: StoreProduct[] = [];
  for (const product of raw ?? []) {
    if (product.platform === "android" && product.type === "subs") {
      for (
        const offer of product.subscriptionOffers ?? []
      ) {
        if (
          !offer.offerTokenAndroid ||
          (offer.pricingPhasesAndroid?.pricingPhaseList.length ?? 0) !== 1
        ) continue;
        const plan = configured.find((p) =>
          p.id === product.id && p.basePlan === offer.basePlanIdAndroid
        );
        const phase = (offer.pricingPhasesAndroid?.pricingPhaseList ?? []).find(
          (p) => p.recurrenceMode === 1,
        );
        if (plan && phase) {
          products.push({
            id: product.id,
            basePlan: offer.basePlanIdAndroid ?? undefined,
            offerToken: offer.offerTokenAndroid,
            price: phase.formattedPrice,
          });
        }
      }
    } else if (product.platform === "ios") {
      products.push({ id: product.id, price: product.displayPrice });
    }
  }
  return {
    products,
    buy: async (product) => {
      if (!active) throw new Error("Account changed.");
      const current = Platform.OS === "android"
        ? (await IAP.getAvailablePurchases()).find((p) =>
          configured.some((c) => c.id === p.productId) &&
          p.purchaseState === "purchased"
        )
        : undefined;
      await IAP.requestPurchase({
        type: "subs",
        request: Platform.OS === "ios"
          ? {
            apple: {
              sku: product.id,
              appAccountToken: catalog.apple_account_token,
              andDangerouslyFinishTransactionAutomatically: false,
            },
          }
          : {
            google: {
              ...(current?.purchaseToken
                ? {
                  purchaseToken: current.purchaseToken,
                  subscriptionProductReplacementParams: {
                    oldProductId: current.productId,
                    replacementMode: "deferred" as const,
                  },
                }
                : {}),
              skus: [product.id],
              obfuscatedAccountId: catalog.google_account_id,
              subscriptionOffers: [{
                sku: product.id,
                offerToken: product.offerToken!,
              }],
            },
          },
      });
    },
    restore: async () => {
      const purchases = await IAP.getAvailablePurchases();
      for (const purchase of purchases) await verify(purchase);
      onVerified();
    },
    manage: async () => {
      await IAP.deepLinkToSubscriptions();
    },
    dispose: () => {
      active = false;
      listener.remove();
      void IAP.endConnection().catch(() => undefined);
    },
  };
}
