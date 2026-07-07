/**
 * Refresh the marketing/print screenshots in public/marketing from the
 * running application, so public-facing surfaces always show the CURRENT UI.
 *
 * Usage:
 *   npm run build && npm start -- -p 3100   (in another terminal)
 *   node scripts/capture-marketing.mjs
 *
 * Requires the demo seed (`npm run seed`) so screenshots show realistic
 * data. Captures at 1400×875 @2x (crisp on retina + in print), mobile at
 * 390×844 @3x.
 */
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const BASE = process.env.CAPTURE_BASE ?? "http://localhost:3100";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "marketing");
mkdirSync(OUT, { recursive: true });

// Prefer the project-local playwright; fall back to the preinstalled one in
// Claude Code's environment.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
}
const executablePath = process.env.CAPTURE_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const PAGES = [
  ["dashboard", "/dashboard"],
  ["schedule", "/schedule"],
  ["dispatch", "/dispatch"],
  ["operations", "/operations"],
  ["maintenance", "/maintenance"],
  ["training", "/training"],
  ["students", "/students"],
  ["crm", "/crm"],
  ["billing", "/billing"],
  ["executive", "/executive"],
  ["intelligence", "/intelligence"],
  ["reports", "/reports"],
  ["import", "/import"],
];

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });

async function login(page, email) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "load" });
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 30000 });
}

const ctx = await browser.newContext({ viewport: { width: 1400, height: 875 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await login(page, "admin@aerops.demo");
for (const [name, route] of PAGES) {
  await page.goto(`${BASE}${route}`, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("captured", name);
}
// Mission Control keeps an SSE stream open — never wait for networkidle.
await page.goto(`${BASE}/mission-control`, { waitUntil: "load" });
await page.waitForTimeout(4500);
await page.screenshot({ path: `${OUT}/mission-control.png` });
console.log("captured mission-control");
await ctx.close();

const fctx = await browser.newContext({ viewport: { width: 1400, height: 875 }, deviceScaleFactor: 2 });
const fpage = await fctx.newPage();
await login(fpage, "founder@aerops.io");
await fpage.goto(`${BASE}/platform/dashboard`, { waitUntil: "load" });
await fpage.waitForTimeout(1200);
await fpage.screenshot({ path: `${OUT}/platform.png` });
console.log("captured platform");
await fctx.close();

const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const mpage = await mctx.newPage();
await login(mpage, "admin@aerops.demo");
await mpage.goto(`${BASE}/dashboard`, { waitUntil: "load" });
await mpage.waitForTimeout(1500);
await mpage.screenshot({ path: `${OUT}/mobile-dashboard.png` });
console.log("captured mobile");
await mctx.close();

await browser.close();
console.log(`CAPTURE COMPLETE → ${OUT}`);
