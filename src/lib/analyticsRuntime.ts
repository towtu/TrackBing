import { Platform } from "react-native";
import { ANALYTICS_CONSENT_KEY, AnalyticsEvent, AnalyticsSnapshot, createAnalytics } from "./analytics";

const serverSnapshot: AnalyticsSnapshot = { configured: false, privacySignal: false, storageAvailable: false, consent: "pending" };
const subscribers = new Set<() => void>();
let service: ReturnType<typeof createAnalytics> | null = null;

export function initialiseAnalytics() {
  if (service) return;
  const isBrowser = Platform.OS === "web" && typeof window !== "undefined";
  let storage: Storage | undefined;
  if (isBrowser) {
    try { storage = window.localStorage; } catch { /* Preference storage blocked by browser policy; fail closed. */ }
  }
  const navigatorPrivacy = isBrowser ? window.navigator as Navigator & { globalPrivacyControl?: boolean } : undefined;
  service = createAnalytics({
    enabled: process.env.EXPO_PUBLIC_ANALYTICS_ENABLED,
    endpoint: process.env.EXPO_PUBLIC_ANALYTICS_ENDPOINT,
    siteOrigin: process.env.EXPO_PUBLIC_SITE_ORIGIN,
    platform: Platform.OS,
    browserOrigin: isBrowser ? window.location.origin : undefined,
    doNotTrack: navigatorPrivacy?.doNotTrack,
    globalPrivacyControl: navigatorPrivacy?.globalPrivacyControl,
    storage,
    request: fetch,
  });
  service.subscribe(() => { for (const callback of subscribers) callback(); });
  if (isBrowser) window.addEventListener("storage", (event) => {
    if (event.storageArea === storage && (event.key === ANALYTICS_CONSENT_KEY || event.key === null)) service?.syncChoice(event.newValue);
  });
  for (const callback of subscribers) callback();
}

export const analyticsStore = {
  subscribe(callback: () => void) { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
  getSnapshot: () => service?.getSnapshot() ?? serverSnapshot,
  getServerSnapshot: () => serverSnapshot,
  choose(choice: "accepted" | "declined") { service?.choose(choice); },
  trackPage(page: unknown) { return service?.trackPage(page) ?? Promise.resolve(); },
};

export function trackAnalyticsEvent(event: AnalyticsEvent) {
  initialiseAnalytics();
  return service?.trackEvent(event) ?? Promise.resolve();
}
