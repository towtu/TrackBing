import { describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY, createAnalytics, getAnalyticsConfig } from "./analytics";

const environment = { enabled: "true", endpoint: "https://plausible.io/api/event", siteOrigin: "https://trackbing.app" };

function fixture(choice: string | null = null) {
  const values = new Map<string, string>();
  if (choice) values.set(ANALYTICS_CONSENT_KEY, choice);
  const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
  const request = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>().mockResolvedValue({ status: 202 });
  const options = { ...environment, platform: "web", browserOrigin: "https://trackbing.app", storage, request };
  return { service: createAnalytics(options), options, storage, request };
}

describe("optional analytics", () => {
  it("sends nothing before consent and never queues pre-consent pages or events", async () => {
    const { service, request } = fixture();
    await service.trackPage("/add");
    await service.trackEvent("sign_in_success");
    expect(request).not.toHaveBeenCalled();
    service.choose("accepted");
    expect(request).not.toHaveBeenCalled();
    await service.trackPage("/profile");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("persists decline and prevents requests on the next visit", async () => {
    const { service, storage, request, options } = fixture();
    service.choose("declined");
    expect(storage.setItem).toHaveBeenCalledWith(ANALYTICS_CONSENT_KEY, "declined");
    await service.trackPage("/auth");
    await createAnalytics(options).trackEvent("sign_up_complete");
    expect(request).not.toHaveBeenCalled();
  });

  it("sends only the documented minimum payload after consent", async () => {
    const { service, request } = fixture("accepted");
    await service.trackPage("/cookbook");
    await service.trackEvent("sign_in_success");
    const init = request.mock.calls[0][1]!;
    expect(request.mock.calls[0][0]).toBe(environment.endpoint);
    expect(JSON.parse(String(init.body))).toEqual({ name: "pageview", url: "https://trackbing.app/cookbook", domain: "trackbing.app" });
    expect(JSON.parse(String(request.mock.calls[1][1]!.body))).toEqual({ name: "Sign in success", url: "https://trackbing.app/auth", domain: "trackbing.app" });
    expect(init).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store", headers: { "Content-Type": "text/plain" } });
    expect(init).not.toHaveProperty("keepalive");
  });

  it("rejects private or unknown routes, query strings, fragments, and arbitrary events", async () => {
    const { service, request } = fixture("accepted");
    for (const route of ["/add?query=rice", "/auth#token=secret", "/food/user-id", "https://trackbing.app/profile", "/profile/", { email: "someone@domain.com" }]) await service.trackPage(route);
    for (const event of ["rice", "person@domain.com", { barcode: "123456" }, null]) await service.trackEvent(event);
    expect(request).not.toHaveBeenCalled();
  });

  it("revokes immediately, aborts pending requests, and sends no later events", async () => {
    const { service, request, storage } = fixture("accepted");
    request.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = service.trackPage("/");
    const signal = request.mock.calls[0][1]!.signal!;
    service.choose("declined");
    expect(signal.aborted).toBe(true);
    expect(storage.setItem).toHaveBeenLastCalledWith(ANALYTICS_CONSENT_KEY, "declined");
    await pending;
    await service.trackPage("/profile");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("applies consent changes from another browser tab and aborts pending requests", async () => {
    const { service, request, storage } = fixture("accepted");
    request.mockImplementationOnce(() => new Promise(() => {}));
    void service.trackPage("/");
    service.syncChoice("declined");
    expect(request.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(service.getSnapshot().consent).toBe("declined");
    expect(storage.setItem).not.toHaveBeenCalled();
    await service.trackPage("/auth");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("ignores broken or unexpected stored choices", async () => {
    const { service, request } = fixture('{"accepted":true,"email":"private"}');
    expect(service.getSnapshot().consent).toBe("pending");
    await service.trackPage("/");
    expect(request).not.toHaveBeenCalled();
  });

  it("stays off for native, a different browser origin, DNT, or Global Privacy Control", async () => {
    const { options, request } = fixture("accepted");
    for (const context of [{ platform: "ios" }, { browserOrigin: "https://preview.vercel.app" }, { doNotTrack: "1" }, { globalPrivacyControl: true }]) {
      const service = createAnalytics({ ...options, ...context });
      service.choose("accepted");
      await service.trackPage("/");
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed when storage cannot read or persist the preference", async () => {
    const { options, request } = fixture();
    const service = createAnalytics({ ...options, storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
    service.choose("accepted");
    await service.trackPage("/");
    expect(service.getSnapshot().storageAvailable).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not break product flows when the analytics request fails", async () => {
    const { service, request } = fixture("accepted");
    request.mockRejectedValue(new Error("network unavailable"));
    await expect(service.trackPage("/")).resolves.toBeUndefined();
  });
});

describe("analytics configuration", () => {
  it("is disabled unless explicitly enabled with both configured origins", () => {
    expect(getAnalyticsConfig({ ...environment, enabled: undefined })).toBeNull();
    expect(getAnalyticsConfig({ ...environment, enabled: "false" })).toBeNull();
    expect(getAnalyticsConfig({ ...environment, siteOrigin: undefined })).toBeNull();
    expect(getAnalyticsConfig({ ...environment, endpoint: undefined })).toBeNull();
    expect(getAnalyticsConfig(environment)).toEqual({ endpoint: environment.endpoint, siteOrigin: environment.siteOrigin, domain: "trackbing.app" });
  });
  it.each(["http://plausible.io/api/event", "https://evil.com/api/event", "https://plausible.io.evil.com/api/event", "https://user:pass@plausible.io/api/event", "https://plausible.io/api/event?email=private", "https://plausible.io/api/event#fragment", "https://plausible.io/api/event/"])("rejects an unapproved endpoint %s", (endpoint) => {
    expect(getAnalyticsConfig({ ...environment, endpoint })).toBeNull();
  });
  it.each(["http://trackbing.app", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://app.local", "https://trackbing.example", "https://example.com", "https://demo.test", "https://127.0.0.1.nip.io", "https://trackbing.app/path", "https://trackbing.app?email=private", "https://user:pass@trackbing.app", "https://trackbing.app:444"])("rejects an unsafe or placeholder site origin %s", (siteOrigin) => {
    expect(getAnalyticsConfig({ ...environment, siteOrigin })).toBeNull();
  });
});
