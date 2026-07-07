/**
 * Verify the marketing homepage as presentation material: screen render,
 * print-media render, and a Letter-format PDF export.
 *
 * Usage: npm run build && npm start -- -p 3100, then
 *   node scripts/verify-print.mjs [output-dir]
 *
 * Two Chromium footguns this script exists to avoid:
 *  1. page.pdf() uses print CSS by default — do NOT emulateMedia("screen")
 *     first, or every @media print rule is silently skipped.
 *  2. Headless pdf() does not force lazy-loaded images the way real Chrome
 *     does on beforeprint — scroll the full page first or below-the-fold
 *     screenshots export as blank frames.
 */
import { mkdirSync } from "fs";
import path from "path";

const BASE = process.env.CAPTURE_BASE ?? "http://localhost:3100";
const OUT = process.argv[2] ?? path.join(process.cwd(), "print-verification");
mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
}
const executablePath = process.env.CAPTURE_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

const failed = [];
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("marketing")) failed.push(`${r.status()} ${r.url()}`); });

await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/home-screen.png` });

// Load every lazy image before print/PDF rendering.
await page.evaluate(async () => {
  for (let y = 0; y <= document.body.scrollHeight; y += 700) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 120));
  }
  window.scrollTo(0, 0);
});
await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0), { timeout: 30000 });

await page.emulateMedia({ media: "print" });
const printState = await page.evaluate(() => ({
  hidden: [...document.querySelectorAll(".print-hidden")].every((el) => getComputedStyle(el).display === "none"),
  headerStatic: getComputedStyle(document.querySelector("header")).position === "static",
}));
await page.screenshot({ path: `${OUT}/home-print-emulated.png` });
await page.emulateMedia({ media: null });
await page.pdf({ path: `${OUT}/aerops-homepage.pdf`, format: "Letter", printBackground: true });

console.log(JSON.stringify({ failedAssetRequests: failed, printState }, null, 2));
if (failed.length || !printState.hidden || !printState.headerStatic) {
  console.error("PRINT VERIFICATION FAILED");
  process.exitCode = 1;
} else {
  console.log(`PRINT VERIFICATION PASSED → ${OUT}`);
}
await browser.close();
