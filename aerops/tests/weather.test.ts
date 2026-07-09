import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { airportWeather, weatherSummary, skyOf, icaoOf } from "@/lib/weather";

/**
 * Weather consistency (Phase 1B audit): one source of truth in lib/weather,
 * keyed to the active organization/location. These tests pin both the
 * engine's contract and the "no hardcoded airports" rule so a future widget
 * can't quietly regress to a pasted METAR string.
 */

const SRC = path.resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(SRC, p).replaceAll("\\", "/");

describe("airportWeather engine", () => {
  const now = new Date("2026-07-07T15:24:00Z");

  it("is deterministic for the same airport within the same hour", () => {
    const a = airportWeather("KAVL", "Asheville Regional", now);
    const b = airportWeather("KAVL", "Asheville Regional", new Date("2026-07-07T15:59:59Z"));
    expect(a).toEqual(b);
  });

  it("varies by airport", () => {
    const icaos = ["KPAO", "KAVL", "KAPA", "KADS", "KBFI", "KSDL"];
    const winds = new Set(icaos.map((i) => `${airportWeather(i, i, now).windDir}/${airportWeather(i, i, now).windKt}`));
    expect(winds.size).toBeGreaterThan(1);
  });

  it("varies over time for the same airport", () => {
    const hours = Array.from({ length: 24 }, (_, h) => airportWeather("KTTA", "Raleigh Exec", new Date(Date.UTC(2026, 6, 7, h))));
    const cats = new Set(hours.map((w) => `${w.windDir}/${w.ceilingFt}`));
    expect(cats.size).toBeGreaterThan(1);
  });

  it("derives flight category from ceiling and visibility, always", () => {
    for (let i = 0; i < 300; i++) {
      const w = airportWeather(`T${i}`, `Test ${i}`, now);
      const expected =
        (w.ceilingFt !== null && w.ceilingFt < 1000) || w.visibilitySm < 3 ? "IFR"
        : (w.ceilingFt !== null && w.ceilingFt < 3000) || w.visibilitySm < 5 ? "MVFR"
        : "VFR";
      expect(w.category).toBe(expected);
      if (w.category !== "VFR") expect(w.risks.length).toBeGreaterThan(0);
    }
  });

  it("formats a complete summary line", () => {
    const w = airportWeather("KAVL", "Asheville Regional", now);
    const s = weatherSummary(w);
    expect(s).toMatch(/^\d{3}° \d+(G\d+)?kt · \d+SM · (CLR|SCT\d{3}|BKN\d{3}|OVC\d{3}) · \d+°C$/);
    expect(skyOf(w)).toMatch(/^(CLR|SCT\d{3}|BKN\d{3}|OVC\d{3})$/);
  });

  it("falls back to a name-derived identifier when a location has no ICAO", () => {
    expect(icaoOf({ icao: "KAVL", name: "Asheville Regional" })).toBe("KAVL");
    expect(icaoOf({ icao: null, name: "Downtown Heliport" })).toBe("DOWN");
  });
});

describe("no hardcoded weather anywhere in the UI", () => {
  // Example placeholder text in search inputs may name an airport; weather
  // widgets may not. Each entry needs a reason.
  const ALLOWED_AIRPORT_MENTIONS = new Set([
    "app/welcome/join/page.tsx", // search examples: "e.g. Golden Gate, KPAO…"
    "app/welcome/create/page.tsx", // ICAO input placeholder example
    "app/platform/organizations/new/new-org-wizard.tsx", // ICAO input placeholder example
  ]);

  it("no component or page hardcodes a METAR-style string", () => {
    const offenders = walk(SRC)
      .filter((p) => /(SCT045|310° 8|10SM · |Wind 310)/.test(readFileSync(p, "utf8")))
      .map(rel)
      .filter((p) => p !== "lib/weather.ts");
    expect(offenders).toEqual([]);
  });

  it("no app page or shell component hardcodes an airport identifier", () => {
    const scopes = [path.join(SRC, "app"), path.join(SRC, "components", "shell")];
    const offenders = scopes
      .flatMap((s) => walk(s))
      .filter((p) => /\bK[A-Z]{3}\b/.test(readFileSync(p, "utf8")))
      .map(rel)
      .filter((p) => !ALLOWED_AIRPORT_MENTIONS.has(p));
    expect(offenders).toEqual([]);
  });

  it("every weather surface consumes lib/weather", () => {
    const missionControl = readFileSync(path.join(SRC, "lib/mission-control.ts"), "utf8");
    expect(missionControl).toMatch(/from "@\/lib\/weather"/);
    const layout = readFileSync(path.join(SRC, "app/(app)/layout.tsx"), "utf8");
    expect(layout).toMatch(/activeLocationWeather/);
    const dashboard = readFileSync(path.join(SRC, "app/(app)/dashboard/page.tsx"), "utf8");
    expect(dashboard).toMatch(/activeLocationWeather/);
    const operations = readFileSync(path.join(SRC, "app/(app)/operations/page.tsx"), "utf8");
    expect(operations).toMatch(/activeLocationWeather/);
  });
});
