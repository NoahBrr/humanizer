/**
 * Captures the per-role dashboards used by the deck's "Role-Based Experience"
 * slide into sales/assets/screens/role-*.png. Requires the app running on
 * :3100 (npm run build && npm start -- -p 3100) with the demo org seeded.
 *
 *   node sales/capture-roles.mjs
 */
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const BASE = process.env.CAPTURE_BASE ?? "http://localhost:3100";
const exe = process.env.CAPTURE_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "screens");
mkdirSync(OUT, { recursive: true });

let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }

const ROLES = [
  ["owner", "admin@aerops.demo"],
  ["dispatcher", "dispatch@aerops.demo"],
  ["instructor", "sarah.cfi@aerops.demo"],
  ["student", "student@aerops.demo"],
  ["maintenance", "maintenance@aerops.demo"],
  ["finance", "accounting@aerops.demo"],
];

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
for (const [name, email] of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: "load" });
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 30000 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `role-${name}.png`) });
  console.log("captured role-" + name);
  await ctx.close();
}
await browser.close();
console.log("role screenshots →", OUT);
