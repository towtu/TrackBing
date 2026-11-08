import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] || resolve(dirname(fileURLToPath(import.meta.url)), "../dist"));
await stat(resolve(root, "index.html"));
let checked = 0;
async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await checkDirectory(path); continue; }
    if (!entry.name.endsWith(".html")) continue;
    // Expo's generated utility/error pages do not render this app's layout.
    if (["_sitemap.html", "+not-found.html"].includes(entry.name)) continue;
    const html = await readFile(path, "utf8");
    const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
    if (titles.length !== 1 || !/\bTrackBing\b/.test(titles[0][1].trim())) {
      throw new Error(`Expected one branded TrackBing browser title in ${path}`);
    }
    checked++;
  }
}
await checkDirectory(root);
console.log(`Verified TrackBing browser titles in ${checked} exported pages.`);
