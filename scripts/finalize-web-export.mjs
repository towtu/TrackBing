import { copyFile, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { load } from "@expo/env";
import { makeSiteConfig, crawlerFiles, PRIVATE_PATHS } from "../src/lib/siteConfig.shared.mjs";

// Expo copies public files; only derive crawl URLs from the operator's configured origin.
// https://docs.expo.dev/router/web/static-rendering/#static-files
// Vercel serves an emitted 404.html with a real 404 when no static file matches:
// https://vercel.com/kb/guide/custom-404-page
process.env.NODE_ENV ??= "production";
load(process.cwd());
const output = resolve(process.argv[2] || "dist");
const config = makeSiteConfig({ origin: process.env.EXPO_PUBLIC_SITE_ORIGIN,
  operator: process.env.EXPO_PUBLIC_LEGAL_OPERATOR,
  privacyEmail: process.env.EXPO_PUBLIC_PRIVACY_EMAIL,
  legalReviewed: process.env.EXPO_PUBLIC_LEGAL_REVIEWED });
const { robots, sitemap } = crawlerFiles(config);
await stat(output);
await copyFile(resolve(output, "+not-found.html"), resolve(output, "404.html"));
await writeFile(resolve(output, "robots.txt"), robots);
await writeFile(resolve(output, "sitemap.xml"), sitemap);
const social = await readFile(resolve(output, "social-preview.png"));
if (social.toString("hex", 0, 8) !== "89504e470d0a1a0a" || social.readUInt32BE(16) !== 1200 || social.readUInt32BE(20) !== 630) {
  throw new Error("Social preview must be the exported 1200×630 PNG.");
}
await stat(resolve(output, "favicon.ico"));

// Legal documents and the static 404 are readable without the application runtime.
// They use ordinary exported anchors. Native continues to use the shared Expo routes.
for(const file of ["privacy.html","terms.html","404.html","+not-found.html"]) {
  const path=resolve(output,file); const html=await readFile(path,"utf8");
  await writeFile(path,html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,"").replace(/<link\b(?=[^>]*rel="(?:preload|modulepreload)")(?=[^>]*as="script")[^>]*>/gi,""));
}
// Fail the release build if the static export accidentally loses public content/metadata.
for (const [file, title, body] of [
  ["index.html", "TrackBing", "Sign In"],
  ["privacy.html", "Privacy policy", "Account, goals, and food diary"],
  ["terms.html", "Terms and conditions", "Nutrition and health limitations"],
  ["404.html", "TrackBing", "This page couldn"],
]) {
  const html = await readFile(resolve(output, file), "utf8");
  if (!/<title\b/.test(html) || !html.includes(title) || !html.includes(body) ||
    !/<meta[^>]+name="description"[^>]+content="[^"]+"/.test(html)) {
    throw new Error(`Public export missing content or metadata: ${file}`);
  }
  if (!config.origin && /(?:rel="canonical"|property="og:url"|property="og:image")/.test(html)) {
    throw new Error(`Public export contains unconfigured canonical/social URL: ${file}`);
  }
}
for (const path of PRIVATE_PATHS) {
  const html = await readFile(resolve(output, path.slice(1) + ".html"), "utf8");
  if (!/<meta[^>]+name="robots"[^>]+content="noindex,nofollow"/.test(html)) {
    throw new Error(`Private export must be noindex: ${path}`);
  }
}
async function checkLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) { await checkLinks(file); continue; }
    if (!entry.name.endsWith(".html")) continue;
    const html = await readFile(file, "utf8");
    for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const path = new URL(href.replaceAll("&amp;", "&"), "https://export.invalid").pathname;
      const target = resolve(output, decodeURIComponent(path).slice(1));
      if (!target.startsWith(output + "/") && target !== output) throw new Error(`Unsafe internal route in ${file}`);
      const candidates = path === "/" ? [resolve(output, "index.html")]
        : [target, target + ".html", resolve(target, "index.html")];
      let exists = false;
      for (const candidate of candidates) {
        try { if ((await stat(candidate)).isFile()) { exists = true; break; } }
        catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
      }
      if (!exists) throw new Error(`Broken internal link ${href} in ${file}`);
    }
  }
}
await checkLinks(output);
console.log(`Web export verified: public content, private noindex, internal links, 404, social asset, favicon, and ${config.indexable ? "configured public sitemap" : "indexing disabled until operator configuration/review"}.`);
