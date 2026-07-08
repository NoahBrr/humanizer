import PptxGenJS from "pptxgenjs";
import path from "path";
import { existsSync } from "fs";
import { SLIDES, VARIANTS } from "./deck-slides.mjs";

import { fileURLToPath } from "url";
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAVY = "0B2447", ROYAL = "1E63D0", SKY = "38A1E8", SLATE = "5B6B7E", INK = "0B2447", LINE = "E4E9F1";
const FONT = "Arial";

function imgPath(ref) {
  if (!ref) return null;
  const base = { marketing: `${APP}/public/marketing`, screens: `${APP}/sales/assets/screens`, assets: `${APP}/sales/assets` }[ref.dir];
  let file = ref.file;
  if (ref.dir === "assets" && file.endsWith(".svg")) file = file.replace(/\.svg$/, ".png"); // pptx uses PNG diagrams
  const p = path.join(base, file);
  return existsSync(p) ? p : null;
}

function build(outFile, variant) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "AO", width: 13.333, height: 7.5 });
  pptx.layout = "AO";
  pptx.author = "AeroOps"; pptx.company = "AeroOps"; pptx.title = "AeroOps — The Operating System for Aviation";

  for (const s of SLIDES) {
    const slide = pptx.addSlide();
    if (s.layout === "cover" || s.layout === "close") {
      slide.background = { color: NAVY };
      const bg = imgPath(s.bg);
      if (bg) slide.addImage({ path: bg, x: 0, y: 0, w: 13.333, h: 7.5, sizing: { type: "cover", w: 13.333, h: 7.5 }, transparency: 88 });
      if (s.layout === "cover") {
        const eb = variant?.coverEyebrow ?? s.eyebrow;
        const sub = variant?.coverSub ?? s.subhead;
        slide.addText(eb.toUpperCase(), { x: 0, y: 2.35, w: 13.333, h: 0.5, align: "center", fontSize: 15, bold: true, color: SKY, charSpacing: 4, fontFace: FONT });
        slide.addText([{ text: "AERO", options: { color: "FFFFFF" } }, { text: "OPS", options: { color: SKY } }], { x: 0, y: 2.8, w: 13.333, h: 1.6, align: "center", fontSize: 96, bold: true, fontFace: FONT });
        slide.addText(sub, { x: 0, y: 4.5, w: 13.333, h: 0.6, align: "center", fontSize: 22, color: "C6CFD8", fontFace: FONT });
        if (variant) slide.addText(variant.name, { x: 0, y: 6.7, w: 13.333, h: 0.4, align: "center", fontSize: 14, bold: true, color: "7F9DC4", charSpacing: 1, fontFace: FONT });
      } else {
        slide.addText(s.headline, { x: 1.2, y: 2.4, w: 10.9, h: 1.6, align: "center", fontSize: 40, bold: true, color: "FFFFFF", fontFace: FONT });
        slide.addText(s.subhead, { x: 0, y: 4.0, w: 13.333, h: 0.5, align: "center", fontSize: 22, color: "C6CFD8", fontFace: FONT });
        slide.addText(s.cta, { x: 4.67, y: 4.9, w: 4.0, h: 0.7, align: "center", valign: "middle", fontSize: 18, bold: true, color: NAVY, fill: { color: "FFFFFF" }, rectRadius: 0.12, fontFace: FONT });
      }
      continue;
    }

    slide.background = { color: "FFFFFF" };
    // footer
    slide.addText([{ text: "AERO", options: { color: NAVY } }, { text: "OPS", options: { color: SKY } }], { x: 0.6, y: 7.0, w: 3, h: 0.35, fontSize: 11, bold: true, fontFace: FONT });

    const headY = 0.7;
    if (s.layout === "split") {
      if (s.dark) slide.background = { color: NAVY };
      const tc = s.dark ? "FFFFFF" : NAVY, sc = s.dark ? "A9BCD8" : SLATE, bc = s.dark ? "DBE6F5" : "243247";
      slide.addText((s.eyebrow || "").toUpperCase(), { x: 0.7, y: headY, w: 6, h: 0.4, fontSize: 13, bold: true, color: s.dark ? SKY : ROYAL, charSpacing: 3, fontFace: FONT });
      slide.addText(s.headline, { x: 0.7, y: headY + 0.4, w: 5.8, h: 1.4, fontSize: 40, bold: true, color: tc, fontFace: FONT });
      if (s.subhead) slide.addText(s.subhead, { x: 0.7, y: headY + 1.7, w: 5.4, h: 0.9, fontSize: 17, color: sc, fontFace: FONT });
      if (s.bullets) slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 18 }, color: bc, fontSize: 16, paraSpaceAfter: 8 } })), { x: 0.8, y: headY + 2.7, w: 5.3, h: 3, fontFace: FONT });
      if (s.footnote) slide.addText(s.footnote, { x: 0.7, y: 6.4, w: 5.4, h: 0.4, fontSize: 11, italic: true, color: s.dark ? "7F9DC4" : "8B98A9", fontFace: FONT });
      const im = imgPath(s.visual);
      if (im) {
        if (s.phone) slide.addImage({ path: im, x: 8.6, y: 1.0, w: 2.5, h: 5.4 });
        else slide.addImage({ path: im, x: 6.6, y: 1.5, w: 6.1, h: 3.8, sizing: { type: "contain", w: 6.1, h: 3.8 } });
      }
    } else if (s.layout === "diagram") {
      slide.addText((s.eyebrow || "").toUpperCase(), { x: 0.7, y: headY, w: 8, h: 0.4, fontSize: 13, bold: true, color: ROYAL, charSpacing: 3, fontFace: FONT });
      slide.addText(s.headline, { x: 0.7, y: headY + 0.4, w: 11, h: 1.0, fontSize: 38, bold: true, color: NAVY, fontFace: FONT });
      if (s.body) slide.addText(s.body, { x: 0.7, y: headY + 1.4, w: 9.5, h: 0.8, fontSize: 16, color: SLATE, fontFace: FONT });
      const im = imgPath(s.visual);
      if (im) slide.addImage({ path: im, x: 1.3, y: 3.1, w: 10.7, h: 3.6, sizing: { type: "contain", w: 10.7, h: 3.6 } });
    } else if (s.layout === "cards" || s.layout === "pricing") {
      const items = s.cards || s.tiles;
      slide.addText((s.eyebrow || "").toUpperCase(), { x: 0.7, y: headY, w: 8, h: 0.4, fontSize: 13, bold: true, color: ROYAL, charSpacing: 3, fontFace: FONT });
      slide.addText(s.headline, { x: 0.7, y: headY + 0.4, w: 11, h: 1.0, fontSize: 40, bold: true, color: NAVY, fontFace: FONT });
      if (s.subhead) slide.addText(s.subhead, { x: 0.7, y: headY + 1.5, w: 11, h: 0.5, fontSize: 17, color: SLATE, fontFace: FONT });
      const n = items.length, gap = 0.35, marg = 0.7, W = (13.333 - marg * 2 - gap * (n - 1)) / n;
      items.forEach((c, i) => {
        const x = marg + i * (W + gap);
        slide.addShape(pptx.ShapeType.roundRect, { x, y: 3.3, w: W, h: 2.6, fill: { color: s.layout === "pricing" ? "F5F9FF" : "FAFCFF" }, line: { color: s.layout === "pricing" ? "CFE0F6" : LINE, width: 1 }, rectRadius: 0.1 });
        slide.addText(c.t, { x: x + 0.25, y: 3.55, w: W - 0.5, h: 0.6, fontSize: 19, bold: true, color: NAVY, fontFace: FONT });
        slide.addText(c.d, { x: x + 0.25, y: 4.2, w: W - 0.5, h: 1.5, fontSize: 14, color: SLATE, fontFace: FONT });
      });
      if (s.cta) slide.addText(s.cta, { x: 0.7, y: 6.2, w: 11, h: 0.5, fontSize: 20, bold: true, color: ROYAL, fontFace: FONT });
    } else if (s.layout === "roadmap") {
      slide.addText((s.eyebrow || "").toUpperCase(), { x: 0.7, y: headY, w: 10, h: 0.4, fontSize: 13, bold: true, color: ROYAL, charSpacing: 3, fontFace: FONT });
      slide.addText(s.headline, { x: 0.7, y: headY + 0.4, w: 11, h: 1.0, fontSize: 38, bold: true, color: NAVY, fontFace: FONT });
      if (s.subhead) slide.addText(s.subhead, { x: 0.7, y: headY + 1.4, w: 11.5, h: 0.5, fontSize: 15, color: SLATE, fontFace: FONT });
      s.tiers.forEach((t, i) => {
        const y = 3.0 + i * 0.72;
        slide.addShape(pptx.ShapeType.roundRect, { x: 0.7, y, w: 11.9, h: 0.62, fill: { color: "FAFCFF" }, line: { color: LINE, width: 1 }, rectRadius: 0.06 });
        slide.addText("ROADMAP", { x: 0.85, y: y + 0.12, w: 1.5, h: 0.38, fontSize: 10, bold: true, color: ROYAL, align: "center", valign: "middle", fill: { color: "E9F1FD" }, rectRadius: 0.1, fontFace: FONT });
        slide.addText([{ text: t.t + "  ", options: { bold: true, color: NAVY } }, { text: t.d, options: { color: SLATE } }], { x: 2.6, y: y + 0.1, w: 9.8, h: 0.42, fontSize: 14, valign: "middle", fontFace: FONT });
      });
    } else if (s.layout === "roleGrid") {
      slide.addText((s.eyebrow || "").toUpperCase(), { x: 0.7, y: 0.5, w: 10, h: 0.4, fontSize: 13, bold: true, color: ROYAL, charSpacing: 3, fontFace: FONT });
      slide.addText(s.headline, { x: 0.7, y: 0.85, w: 11, h: 0.9, fontSize: 36, bold: true, color: NAVY, fontFace: FONT });
      if (s.subhead) slide.addText(s.subhead, { x: 0.7, y: 1.65, w: 11.8, h: 0.5, fontSize: 14, color: SLATE, fontFace: FONT });
      const cols = 3, W = 3.75, H = 1.95, gx = 0.42, gy = 0.55, x0 = 0.7, y0 = 2.4;
      s.roles.forEach((r, i) => {
        const cx = x0 + (i % cols) * (W + gx), cy = y0 + Math.floor(i / cols) * (H + gy);
        const im = imgPath({ dir: "screens", file: r.file });
        if (im) slide.addImage({ path: im, x: cx, y: cy, w: W, h: H, sizing: { type: "crop", w: W, h: H }, rounding: true });
        slide.addText(r.label, { x: cx, y: cy + H + 0.02, w: W, h: 0.35, fontSize: 13, bold: true, color: NAVY, fontFace: FONT });
      });
    }
  }
  return pptx.writeFile({ fileName: outFile });
}

await build(`${APP}/sales/AeroOps-Deck.pptx`, null);
await build(`${APP}/sales/AeroOps-Deck-Part61.pptx`, VARIANTS.part61);
await build(`${APP}/sales/AeroOps-Deck-Part141.pptx`, VARIANTS.part141);
await build(`${APP}/sales/AeroOps-Deck-University.pptx`, VARIANTS.university);
console.log("PPTX decks written to sales/");
