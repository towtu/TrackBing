// Playwright check: loads scan page (bypasses auth), inspects console for JS errors
// and checks whether ZXing imports resolve correctly.
import { chromium } from "playwright";

const BASE_URL = "http://localhost:8085";

const browser = await chromium.launch({
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
});

const ctx = await browser.newContext({ permissions: ["camera"] });
const page = await ctx.newPage();

const consoleLogs = [];
const pageErrors = [];
const networkFails = [];

page.on("console", (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("requestfailed", (r) =>
  networkFails.push(`${r.url()} :: ${r.failure()?.errorText}`)
);

// Step 1: load root to let React boot
await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(2000);

console.log("=== Root page URL:", page.url());
console.log("=== Root page errors:", pageErrors.length > 0 ? pageErrors : "none");

// Step 2: inject a test that dynamically imports ZXing (same as WebBarcodeScanner does)
// This verifies ZXing modules resolve, independent of auth.
const zxingResult = await page.evaluate(async () => {
  try {
    const { BrowserMultiFormatReader } = await import(
      "/@zxing/browser"
    ).catch(() => import("/node_modules/@zxing/browser/esm/index.js").catch(() => ({ BrowserMultiFormatReader: null })));
    return {
      success: true,
      hasBrowserMultiFormatReader: typeof BrowserMultiFormatReader === "function",
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});
console.log("=== ZXing dynamic import test:", zxingResult);

// Step 3: navigate to scan page and see what happens
consoleLogs.length = 0;
pageErrors.length = 0;
await page.goto(`${BASE_URL}/scan`, { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);

const url = page.url();
const hasVideo = await page.evaluate(() => !!document.querySelector("video"));
const visibleText = await page.evaluate(() =>
  document.body.innerText.slice(0, 300).replace(/\n+/g, " ").trim()
);

console.log("\n=== /scan navigation result");
console.log("Final URL:", url);
console.log("Has <video>:", hasVideo);
console.log("Visible text:", visibleText);
console.log("JS errors:", pageErrors.length > 0 ? pageErrors : "none");
console.log("Console logs:", consoleLogs.slice(0, 10));

await browser.close();
