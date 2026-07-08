/**
 * Portal verification — asserts the RENDERED authed app reflects the latest
 * build, so "the code was committed but the portal shows stale UI" can't pass
 * unnoticed. Run against a freshly-built server:
 *
 *   rm -rf .next && npm run build && npm start -- -p 3100   (one terminal)
 *   node scripts/verify-portal.mjs                          (another)
 *
 * It prints the served BUILD_ID and checks the actual DOM (not source) for the
 * shell/dashboard/settings markers, plus console/hydration errors. Exits non-
 * zero if anything is missing — cache/stale-server regressions fail loudly.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const BASE = process.env.PORTAL_BASE ?? "http://localhost:3100";
const EMAIL = process.env.PORTAL_EMAIL ?? "admin@aerops.demo";
const PASSWORD = process.env.PORTAL_PASSWORD ?? "demo1234";
const executablePath = process.env.CAPTURE_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let buildId = "unknown";
try {
  buildId = readFileSync(path.join(root, ".next/BUILD_ID"), "utf8").trim();
} catch {
  /* dev server has no BUILD_ID */
}
console.log("BUILD_ID on disk:", buildId);

const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));

await page.goto(`${BASE}/sign-in`, { waitUntil: "load" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("sign-in"), { timeout: 30000 });

await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
await page.waitForTimeout(1500);
const dash = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    "sidebar: 5 collapsible category toggles": document.querySelectorAll("aside button[aria-expanded]").length === 5,
    "sidebar: Command Center group": /Command Center/i.test(txt),
    "dashboard: Operations Overview eyebrow": /Operations Overview/i.test(txt),
    "dashboard: Customize control": [...document.querySelectorAll("button")].some((b) => /customize/i.test(b.textContent)),
  };
});

await page.goto(`${BASE}/settings`, { waitUntil: "load" });
await page.waitForTimeout(1200);
const settings = await page.evaluate(() => {
  const txt = document.body.innerText;
  return {
    "settings: Save changes control": [...document.querySelectorAll("button")].some((b) => /save changes/i.test(b.textContent)),
    "settings: slug locked notice": /slug is locked/i.test(txt),
    "settings: Manage lesson types link": /manage lesson types/i.test(txt),
  };
});

await browser.close();

const checks = { ...dash, ...settings, "runtime: no console/page errors": errors.length === 0 };
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) ok = false;
}
if (errors.length) errors.slice(0, 5).forEach((e) => console.log("    error:", e.slice(0, 160)));

if (ok) {
  console.log("PORTAL VERIFICATION PASSED — the rendered app reflects the current build.");
  process.exit(0);
} else {
  console.log("PORTAL VERIFICATION FAILED — rebuild from a clean .next and a fresh server (stale cache/server?).");
  process.exit(1);
}
