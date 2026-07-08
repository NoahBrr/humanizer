/**
 * Renders the AeroOps sales deck (sales/deck-slides.mjs) into premium,
 * self-contained 16:9 HTML decks, and — with `--pdf` — into PDFs via the
 * preinstalled Chromium. Produces the master deck plus one variant per
 * customer type (Part 61 / Part 141 / University).
 *
 *   node sales/build-deck.mjs          # write HTML decks
 *   node sales/build-deck.mjs --pdf    # write HTML + render PDFs (server not needed)
 */
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { SLIDES, VARIANTS, BRAND } from "./deck-slides.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url)); // aerops/sales
const OUT = path.join(ROOT, "deck");
mkdirSync(OUT, { recursive: true });

// Resolve an {dir,file} ref to a path relative to sales/deck/*.html.
function rel(ref) {
  if (!ref) return "";
  const map = { marketing: "../../public/marketing", screens: "../assets/screens", assets: "../assets" };
  return `${map[ref.dir]}/${ref.file}`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function frame(src, { dark = false } = {}) {
  return `<div class="frame ${dark ? "frame-dark" : ""}">
    <div class="frame-bar"><span></span><span></span><span></span></div>
    <img src="${src}" alt=""/>
  </div>`;
}
function phoneFrame(src) {
  return `<div class="phone"><img src="${src}" alt=""/></div>`;
}
function bullets(list) {
  return `<ul class="bullets">${list.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`;
}
function eyebrow(t) {
  return t ? `<p class="eyebrow">${esc(t)}</p>` : "";
}
function foot(n, total) {
  return `<div class="foot"><span class="wm">AERO<b>OPS</b></span><span class="pg">${n} / ${total}</span></div>`;
}

function renderSlide(s, i, total, variant) {
  const n = i + 1;
  let inner = "";
  if (s.layout === "cover") {
    const eb = variant?.coverEyebrow ?? s.eyebrow;
    const sub = variant?.coverSub ?? s.subhead;
    inner = `<div class="cover">
      <img class="cover-bg" src="${rel(s.bg)}" alt=""/>
      <div class="cover-inner">
        <p class="cover-eyebrow">${esc(eb)}</p>
        <h1 class="cover-mark">AERO<span>OPS</span></h1>
        <p class="cover-sub">${esc(sub)}</p>
      </div>
      ${variant ? `<div class="cover-variant">${esc(variant.name)}</div>` : ""}
    </div>`;
  } else if (s.layout === "split") {
    const visual = s.phone ? phoneFrame(rel(s.visual)) : frame(rel(s.visual), { dark: s.dark });
    inner = `<div class="split ${s.dark ? "split-dark" : ""}">
      <div class="col-text">
        ${eyebrow(s.eyebrow)}
        <h2>${esc(s.headline)}</h2>
        ${s.subhead ? `<p class="subhead">${esc(s.subhead)}</p>` : ""}
        ${s.bullets ? bullets(s.bullets) : ""}
        ${s.footnote ? `<p class="footnote">${esc(s.footnote)}</p>` : ""}
      </div>
      <div class="col-visual ${s.phone ? "col-visual-phone" : ""}">${visual}</div>
    </div>`;
  } else if (s.layout === "diagram") {
    inner = `<div class="diagram">
      <div class="diagram-head">
        ${eyebrow(s.eyebrow)}
        <h2>${esc(s.headline)}</h2>
        ${s.body ? `<p class="subhead">${esc(s.body)}</p>` : ""}
        ${s.bullets ? bullets(s.bullets) : ""}
      </div>
      <div class="diagram-art"><img src="${rel(s.visual)}" alt=""/></div>
    </div>`;
  } else if (s.layout === "cards") {
    inner = `<div class="section">
      ${eyebrow(s.eyebrow)}
      <h2>${esc(s.headline)}</h2>
      ${s.subhead ? `<p class="subhead">${esc(s.subhead)}</p>` : ""}
      <div class="cards cards-${s.cards.length}">
        ${s.cards.map((c) => `<div class="card"><p class="card-t">${esc(c.t)}</p><p class="card-d">${esc(c.d)}</p></div>`).join("")}
      </div>
    </div>`;
  } else if (s.layout === "roleGrid") {
    inner = `<div class="section">
      ${eyebrow(s.eyebrow)}
      <h2>${esc(s.headline)}</h2>
      ${s.subhead ? `<p class="subhead">${esc(s.subhead)}</p>` : ""}
      <div class="roles">
        ${s.roles.map((r) => `<div class="role"><div class="role-shot"><img src="${rel({ dir: "screens", file: r.file })}" alt=""/></div><p>${esc(r.label)}</p></div>`).join("")}
      </div>
    </div>`;
  } else if (s.layout === "roadmap") {
    inner = `<div class="section">
      ${eyebrow(s.eyebrow)}
      <h2>${esc(s.headline)}</h2>
      ${s.subhead ? `<p class="subhead">${esc(s.subhead)}</p>` : ""}
      <div class="tiers">
        ${s.tiers.map((t) => `<div class="tier"><span class="badge">Roadmap</span><div><p class="tier-t">${esc(t.t)}</p><p class="tier-d">${esc(t.d)}</p></div></div>`).join("")}
      </div>
    </div>`;
  } else if (s.layout === "pricing") {
    inner = `<div class="section">
      ${eyebrow(s.eyebrow)}
      <h2>${esc(s.headline)}</h2>
      ${s.subhead ? `<p class="subhead">${esc(s.subhead)}</p>` : ""}
      <div class="cards cards-3">
        ${s.tiles.map((c) => `<div class="card card-hi"><p class="card-t">${esc(c.t)}</p><p class="card-d">${esc(c.d)}</p></div>`).join("")}
      </div>
      <p class="price-cta">${esc(s.cta)}</p>
    </div>`;
  } else if (s.layout === "close") {
    inner = `<div class="cover close">
      <img class="cover-bg" src="${rel(s.bg)}" alt=""/>
      <div class="cover-inner">
        <h1 class="close-h">${esc(s.headline)}</h1>
        <p class="close-sub">${esc(s.subhead)}</p>
        <div class="cta">${esc(s.cta)}</div>
      </div>
    </div>`;
  }
  const isDark = s.layout === "cover" || s.layout === "close";
  return `<section class="slide ${isDark ? "slide-dark" : ""}">${inner}${isDark ? "" : foot(n, total)}</section>`;
}

const CSS = `
:root{--navy:${BRAND.navy};--royal:${BRAND.royal};--sky:${BRAND.sky};--silver:${BRAND.silver};--slate:${BRAND.slate};--line:#e4e9f1;--bg:#f7f9fc;}
*{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
html,body{font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:var(--navy);background:#c9d2df;}
@page{size:1280px 720px;margin:0;}
.slide{position:relative;width:1280px;height:720px;background:#fff;overflow:hidden;page-break-after:always;display:flex;}
.slide-dark{background:var(--navy);}
.slide>*{flex:1;}
h2{font-size:52px;line-height:1.03;font-weight:800;letter-spacing:-1.2px;color:var(--navy);}
.eyebrow{font-size:15px;font-weight:700;letter-spacing:2.4px;text-transform:uppercase;color:var(--royal);margin-bottom:18px;}
.subhead{font-size:22px;line-height:1.4;color:var(--slate);margin-top:18px;font-weight:450;max-width:38ch;}
.bullets{list-style:none;margin-top:26px;display:flex;flex-direction:column;gap:14px;}
.bullets li{position:relative;padding-left:26px;font-size:20px;line-height:1.35;color:#243247;font-weight:500;}
.bullets li::before{content:"";position:absolute;left:0;top:10px;width:8px;height:8px;border-radius:99px;background:var(--sky);}
.footnote{margin-top:26px;font-size:14px;color:#8b98a9;font-style:italic;}
.foot{position:absolute;left:64px;right:64px;bottom:34px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#9aa7b8;}
.foot .wm{font-weight:800;letter-spacing:1.5px;color:var(--navy);}
.foot .wm b{color:var(--sky);font-weight:800;}

/* split */
.split{display:flex;align-items:center;gap:56px;padding:88px 64px 96px;}
.split .col-text{flex:0 0 44%;}
.split .col-visual{flex:1;display:flex;justify-content:center;align-items:center;}
.split-dark{background:var(--navy);}
.split-dark h2{color:#fff;}.split-dark .subhead{color:#a9bcd8;}.split-dark .bullets li{color:#dbe6f5;}.split-dark .eyebrow{color:var(--sky);}
.frame{width:100%;max-width:640px;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:#fff;box-shadow:0 30px 60px -28px rgba(11,36,71,.45);}
.frame-dark{border-color:#20365c;}
.frame-bar{height:30px;background:#eef2f8;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:7px;padding:0 14px;}
.frame-bar span{width:10px;height:10px;border-radius:99px;background:#cfd8e6;}
.frame img{display:block;width:100%;}
.col-visual-phone .phone{width:240px;border:9px solid #2e3a46;border-radius:34px;overflow:hidden;box-shadow:0 30px 60px -25px rgba(11,36,71,.5);background:#2e3a46;}
.phone img{display:block;width:100%;border-radius:24px;}

/* diagram */
.diagram{display:flex;flex-direction:column;padding:72px 64px 88px;}
.diagram-head{max-width:70%;}
.diagram-head h2{font-size:46px;}
.diagram-head .bullets{margin-top:18px;}.diagram-head .bullets li{font-size:18px;}
.diagram-art{flex:1;display:flex;align-items:center;justify-content:center;margin-top:20px;}
.diagram-art img{max-width:100%;max-height:360px;}

/* section + cards */
.section{padding:66px 64px 92px;display:flex;flex-direction:column;}
.cards{display:grid;gap:20px;margin-top:40px;}
.cards-4{grid-template-columns:repeat(4,1fr);}
.cards-3{grid-template-columns:repeat(3,1fr);}
.card{border:1px solid var(--line);border-radius:16px;padding:28px;background:linear-gradient(180deg,#fff, #fafcff);box-shadow:0 2px 4px rgba(11,36,71,.05);}
.card-t{font-size:21px;font-weight:750;color:var(--navy);margin-bottom:10px;}
.card-d{font-size:16px;line-height:1.45;color:var(--slate);}
.card-hi{border-color:#cfe0f6;background:linear-gradient(180deg,#f5f9ff,#eef4fc);}
.price-cta{margin-top:34px;font-size:22px;font-weight:750;color:var(--royal);}

/* roles */
.roles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 24px;margin-top:26px;}
.role-shot{border:1px solid var(--line);border-radius:12px;overflow:hidden;height:132px;box-shadow:0 10px 24px -14px rgba(11,36,71,.4);}
.role-shot img{width:100%;height:100%;object-fit:cover;object-position:top left;}
.role p{margin-top:9px;font-size:15px;font-weight:650;color:var(--navy);}

/* roadmap */
.tiers{margin-top:34px;display:flex;flex-direction:column;gap:14px;}
.tier{display:flex;align-items:center;gap:20px;border:1px solid var(--line);border-radius:14px;padding:18px 22px;background:#fafcff;}
.badge{flex:0 0 auto;font-size:12px;font-weight:750;letter-spacing:1px;text-transform:uppercase;color:var(--royal);background:#e9f1fd;border:1px solid #cfe0f6;border-radius:99px;padding:6px 12px;}
.tier-t{font-size:19px;font-weight:700;color:var(--navy);}
.tier-d{font-size:15px;color:var(--slate);margin-top:2px;}

/* cover + close */
.cover{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;background:radial-gradient(120% 100% at 50% 0%,#143063,#0b2447);}
.cover-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.10;filter:saturate(.6);}
.cover-inner{position:relative;text-align:center;padding:0 80px;}
.cover-eyebrow{color:var(--sky);font-size:17px;font-weight:700;letter-spacing:4px;text-transform:uppercase;margin-bottom:26px;}
.cover-mark{font-size:104px;font-weight:850;letter-spacing:-2px;color:#fff;}
.cover-mark span{color:var(--sky);}
.cover-sub{margin-top:22px;font-size:26px;color:#c6cfd8;font-weight:450;}
.cover-variant{position:absolute;bottom:40px;left:0;right:0;text-align:center;color:#7f9dc4;font-size:15px;font-weight:600;letter-spacing:1px;}
.close-h{font-size:60px;font-weight:800;color:#fff;letter-spacing:-1.5px;max-width:20ch;margin:0 auto;line-height:1.05;}
.close-sub{margin-top:22px;font-size:26px;color:#c6cfd8;}
.cta{display:inline-block;margin-top:38px;background:#fff;color:var(--navy);font-weight:750;font-size:20px;padding:16px 34px;border-radius:12px;}
`;

function buildHTML(title, variant) {
  const total = SLIDES.length;
  const body = SLIDES.map((s, i) => renderSlide(s, i, total, s.layout === "cover" ? variant : null)).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

const decks = [
  { file: "aerops-deck.html", pdf: "AeroOps-Deck.pdf", title: "AeroOps — Sales Deck", variant: null },
  { file: "aerops-deck-part61.html", pdf: "AeroOps-Deck-Part61.pdf", title: "AeroOps — Part 61", variant: VARIANTS.part61 },
  { file: "aerops-deck-part141.html", pdf: "AeroOps-Deck-Part141.pdf", title: "AeroOps — Part 141", variant: VARIANTS.part141 },
  { file: "aerops-deck-university.html", pdf: "AeroOps-Deck-University.pdf", title: "AeroOps — University", variant: VARIANTS.university },
];

for (const d of decks) {
  writeFileSync(path.join(OUT, d.file), buildHTML(d.title, d.variant));
  console.log("wrote", d.file);
}

if (process.argv.includes("--pdf")) {
  const exe = process.env.CAPTURE_CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs")); }
  const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  for (const d of decks) {
    await page.goto("file://" + path.join(OUT, d.file), { waitUntil: "networkidle" });
    await page.pdf({ path: path.join(ROOT, d.pdf), preferCSSPageSize: true, printBackground: true });
    console.log("rendered", d.pdf);
  }
  await browser.close();
}
