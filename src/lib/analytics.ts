// Deliberately uses the minimum documented Plausible Events API payload.
// https://plausible.io/docs/events-api — no script, props, referrer, or identity.
import { makeSiteConfig } from "./siteConfig.shared.mjs";
export const ANALYTICS_CONSENT_KEY = "trackbing.analytics-consent.v1";
const ALLOWED_ENDPOINTS = new Set(["https://plausible.io/api/event"]);
const CANONICAL_PAGES = new Set(["/", "/auth", "/add", "/stats", "/profile", "/cookbook", "/privacy", "/terms"]);
const EVENT_NAMES = { sign_in_success: "Sign in success", sign_up_complete: "Sign up complete" } as const;
export type AnalyticsEvent = keyof typeof EVENT_NAMES;
export type AnalyticsConsent = "pending" | "accepted" | "declined";

interface AnalyticsEnvironment {
  enabled?: string;
  endpoint?: string;
  siteOrigin?: string;
}
interface AnalyticsOptions extends AnalyticsEnvironment {
  platform: string;
  browserOrigin?: string;
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
  storage?: Pick<Storage, "getItem" | "setItem">;
  request: (url: string, init: RequestInit) => Promise<unknown>;
}
export interface AnalyticsSnapshot {
  configured: boolean;
  privacySignal: boolean;
  storageAvailable: boolean;
  consent: AnalyticsConsent;
}

export function getAnalyticsConfig(environment: AnalyticsEnvironment) {
  if (environment.enabled !== "true" || !environment.endpoint || !ALLOWED_ENDPOINTS.has(environment.endpoint) || !environment.siteOrigin) return null;
  const siteOrigin = makeSiteConfig({ origin: environment.siteOrigin }).origin;
  return siteOrigin ? { endpoint: environment.endpoint, siteOrigin, domain: new URL(siteOrigin).hostname } : null;
}

function parseChoice(value: unknown): AnalyticsConsent {
  return value === "accepted" || value === "declined" ? value : "pending";
}

export function createAnalytics(options: AnalyticsOptions) {
  const config = getAnalyticsConfig(options);
  const configured = options.platform === "web" && config !== null && options.browserOrigin === config.siteOrigin;
  let snapshot: AnalyticsSnapshot = {
    configured,
    privacySignal: options.doNotTrack === "1" || options.doNotTrack === "yes" || options.globalPrivacyControl === true,
    storageAvailable: !!options.storage,
    consent: "pending",
  };
  const listeners = new Set<() => void>();
  const requests = new Set<AbortController>();
  if (configured && options.storage) {
    try {
      snapshot = { ...snapshot, consent: parseChoice(options.storage.getItem(ANALYTICS_CONSENT_KEY)) };
    } catch {
      snapshot = { ...snapshot, storageAvailable: false };
    }
  }

  function update(next: AnalyticsSnapshot) {
    snapshot = next;
    if (next.consent !== "accepted" || !next.storageAvailable || next.privacySignal) {
      for (const request of requests) request.abort();
      requests.clear();
    }
    for (const listener of listeners) listener();
  }

  async function send(name: string, page: string) {
    if (!config || !snapshot.configured || snapshot.consent !== "accepted" || snapshot.privacySignal || !snapshot.storageAvailable || requests.size >= 3) return;
    const controller = new AbortController();
    requests.add(controller);
    try {
      await options.request(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ name, url: `${config.siteOrigin}${page}`, domain: config.domain }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      // Optional measurements are dropped on failure; never retry or retain them.
    } finally {
      requests.delete(controller);
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    choose(choice: "accepted" | "declined") {
      if (!snapshot.configured || (choice !== "accepted" && choice !== "declined")) return;
      // Revoke before attempting storage: a blocked storage write cannot keep traffic active.
      if (choice === "declined") update({ ...snapshot, consent: choice });
      try {
        if (!options.storage) throw new Error("Preference storage unavailable");
        options.storage.setItem(ANALYTICS_CONSENT_KEY, choice);
        if (choice === "accepted") update({ ...snapshot, consent: choice });
      } catch {
        update({ ...snapshot, storageAvailable: false, consent: "declined" });
      }
    },
    syncChoice(value: unknown) {
      update({ ...snapshot, consent: parseChoice(value) });
    },
    async trackPage(page: unknown) {
      if (typeof page === "string" && CANONICAL_PAGES.has(page)) await send("pageview", page);
    },
    async trackEvent(event: unknown) {
      if (typeof event === "string" && Object.prototype.hasOwnProperty.call(EVENT_NAMES, event)) await send(EVENT_NAMES[event as AnalyticsEvent], "/auth");
    },
    dispose() {
      for (const request of requests) request.abort();
      requests.clear();
      listeners.clear();
    },
  };
}
