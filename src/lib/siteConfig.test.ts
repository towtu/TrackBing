import { describe, expect, it } from "vitest";
import { crawlerFiles, makeSiteConfig, pageMetadata, routeKind } from "./siteConfig.shared.mjs";

const reviewed = {origin: "https://trackbing.vercel.app", operator: "Test operator", privacyEmail: "privacy@trackbing.test", legalReviewed: "true"};
describe("public launch configuration", () => {
  it.each([undefined, "http://trackbing.vercel.app", "https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://example.com", "https://app.test", "https://app.example", "https://private.internal", "https://app.home", "https://127.0.0.1.nip.io", "https://localtest.me", "https://double..dot.com", "https://trackbing.vercel.app/path", "https://user:password@trackbing.vercel.app", "https://trackbing.vercel.app:444", "https://trackbing.vercel.app?q=x"])("rejects unsafe/placeholder origin %s", origin => {
    const config = makeSiteConfig({ ...reviewed, origin });
    expect(config.origin).toBeNull();
    expect(crawlerFiles(config).robots).toBe("User-agent: *\nDisallow: /\n");
    expect(pageMetadata("/", config).canonical).toBeNull();
  });
  it("never invents legal operator/contact or enables indexing for a draft", () => {
    const config = makeSiteConfig({ origin: reviewed.origin, legalReviewed: "true" });
    expect(config.operator).toBeNull();
    expect(config.privacyEmail).toBeNull();
    expect(config.legalReviewed).toBe(false);
    expect(crawlerFiles(config).sitemap).not.toContain("<loc>");
    expect(pageMetadata("/privacy", config).robots).toBe("noindex,nofollow");
  });
  it.each(["privacy@example.com\nBcc:bad@example.com", "not-email", "<script>@app.com"])("rejects invalid contact %s", privacyEmail => {
    expect(makeSiteConfig({ ...reviewed, privacyEmail }).privacyEmail).toBeNull();
  });
  it("publishes only the real public origin and public final routes", () => {
    const config = makeSiteConfig(reviewed);
    expect(config.indexable).toBe(true);
    const crawl = crawlerFiles(config);
    expect(crawl.sitemap.match(/<loc>/g)).toHaveLength(3);
    expect(crawl.sitemap).toContain("https://trackbing.vercel.app/privacy");
    expect(crawl.sitemap).not.toContain("/profile");
    expect(crawl.sitemap).not.toContain("/auth");
    expect(pageMetadata("/terms", config).socialImage).toBe("https://trackbing.vercel.app/social-preview.png");
    expect(pageMetadata("/profile", config).robots).toBe("noindex,nofollow");
    expect(pageMetadata("/auth", config).canonical).toBeNull();
  });
  it("distinguishes reachable legal routes from private and unknown routes", () => {
    expect(routeKind("/privacy")).toBe("public");
    expect(routeKind("/terms")).toBe("public");
    expect(routeKind("/auth")).toBe("public");
    expect(routeKind("/profile")).toBe("private");
    expect(routeKind("/not-a-page")).toBe("not-found");
  });
});
