/**
 * Renders the AeroOps sales markdown docs into premium, branded PDFs (US
 * Letter) using the preinstalled Chromium. Lightweight Markdown → HTML for
 * headings, bold/italic/code, lists, tables, and rules — enough for these
 * hand-written one-pagers and enablement docs.
 *
 *   node sales/build-docs.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTMLDIR = path.join(ROOT, "print");
mkdirSync(HTMLDIR, { recursive: true });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

function mdToHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const flushList = (buf) => { if (buf.length) out.push(`<ul>${buf.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`); };
  while (i < lines.length) {
    let line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^#{1,3}\s/.test(line)) {
      const lvl = line.match(/^(#{1,3})/)[1].length;
      out.push(`<h${lvl}>${inline(line.replace(/^#{1,3}\s/, ""))}</h${lvl}>`); i++; continue;
    }
    if (/^---\s*$/.test(line)) { out.push("<hr/>"); i++; continue; }
    if (/^\s*[-*]\s/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        let item = lines[i].replace(/^\s*[-*]\s/, ""); i++;
        // Join soft-wrapped continuation lines into the current list item.
        while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,3}\s|---|\s*[-*]\s|\|)/.test(lines[i])) { item += " " + lines[i].trim(); i++; }
        buf.push(item);
      }
      flushList(buf); continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const isSep = (r) => /^\|?[\s:-]+\|/.test(r) && r.replace(/[^|]/g, "").length >= 1 && /-/.test(r);
      let head = null, bodyStart = 0;
      if (rows.length > 1 && isSep(rows[1])) { head = cells(rows[0]); bodyStart = 2; }
      let t = "<table>";
      if (head) t += `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`;
      t += "<tbody>";
      for (let r = bodyStart; r < rows.length; r++) { if (isSep(rows[r])) continue; t += `<tr>${cells(rows[r]).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`; }
      t += "</tbody></table>";
      out.push(t); continue;
    }
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,3}\s|---|\s*[-*]\s|\|)/.test(lines[i])) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

const CSS = `
*{box-sizing:border-box;}
@page{size:letter;margin:0;}
html,body{margin:0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0b2447;font-size:11.2px;line-height:1.5;}
.page{padding:0 0 60px;}
.band{background:radial-gradient(120% 160% at 0% 0%,#143063,#0b2447);color:#fff;padding:26px 54px 22px;display:flex;align-items:center;justify-content:space-between;}
.band .wm{font-size:19px;font-weight:800;letter-spacing:1.5px;}
.band .wm span{color:#38a1e8;}
.band .doc{font-size:12px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#9fc0e8;}
.body{padding:30px 54px 0;}
h1{font-size:26px;font-weight:800;letter-spacing:-.5px;margin:2px 0 4px;}
h2{font-size:17px;font-weight:750;color:#0b2447;margin:20px 0 6px;}
h3{font-size:13px;font-weight:700;color:#1e63d0;margin:16px 0 4px;letter-spacing:.2px;}
p{margin:7px 0;color:#243247;}
strong{color:#0b2447;font-weight:700;}
ul{margin:7px 0 7px 2px;padding-left:18px;}
li{margin:4px 0;color:#243247;}
li::marker{color:#38a1e8;}
hr{border:none;border-top:1px solid #e4e9f1;margin:16px 0;}
code{background:#eef2f8;border-radius:4px;padding:1px 5px;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#154aa0;}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:10.4px;}
th{background:#0b2447;color:#fff;text-align:left;padding:8px 10px;font-weight:600;font-size:10px;}
td{border:1px solid #e4e9f1;padding:7px 10px;vertical-align:top;}
tbody tr:nth-child(even){background:#f7f9fc;}
.foot{position:fixed;bottom:0;left:0;right:0;padding:12px 54px;display:flex;justify-content:space-between;font-size:9.5px;color:#8b98a9;border-top:1px solid #eef2f8;background:#fff;}
.foot b{color:#0b2447;}
`;

function wrap(docLabel, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"/><style>${CSS}</style></head><body>
  <div class="page">
    <div class="band"><span class="wm">AERO<span>OPS</span></span><span class="doc">${esc(docLabel)}</span></div>
    <div class="body">${bodyHtml}</div>
  </div>
  <div class="foot"><span>AeroOps — The Operating System for Aviation</span><span><b>aerops.io</b> · Request a demo</span></div>
  </body></html>`;
}

const DOCS = [
  { md: "EXECUTIVE_SUMMARY.md", label: "Executive Summary", pdf: "AeroOps-Executive-Summary.pdf" },
  { md: "BROCHURE.md", label: "Sales Brochure", pdf: "AeroOps-Brochure.pdf" },
  { md: "COMPARISON.md", label: "Feature Comparison", pdf: "AeroOps-Comparison.pdf" },
  { md: "DEMO_SCRIPT.md", label: "20-Minute Demo Script", pdf: "AeroOps-Demo-Script.pdf" },
  { md: "OBJECTION_GUIDE.md", label: "Objection Handling", pdf: "AeroOps-Objection-Guide.pdf" },
  { md: "CUSTOMER_VARIANTS.md", label: "Customer Playbooks", pdf: "AeroOps-Customer-Playbooks.pdf" },
];

for (const d of DOCS) {
  const md = readFileSync(path.join(ROOT, d.md), "utf8");
  writeFileSync(path.join(HTMLDIR, d.md.replace(/\.md$/, ".html")), wrap(d.label, mdToHtml(md)));
}
console.log("wrote HTML for", DOCS.length, "docs");

const exe = process.env.CAPTURE_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage();
for (const d of DOCS) {
  await page.goto("file://" + path.join(HTMLDIR, d.md.replace(/\.md$/, ".html")), { waitUntil: "networkidle" });
  await page.pdf({ path: path.join(ROOT, d.pdf), format: "Letter", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } });
  console.log("rendered", d.pdf);
}
await browser.close();
