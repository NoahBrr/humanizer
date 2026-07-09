import { db } from "@/lib/db";

/**
 * Weather — single source of truth.
 *
 * Every weather surface in AeroOps (top bar chip, dashboard header,
 * operations board, Mission Control status bar and per-airport panels)
 * renders from `airportWeather()` for the ACTIVE organization's ACTIVE
 * location. Nothing hardcodes an airport or a METAR string; changing the
 * organization's locations changes every widget on the next render.
 *
 * The generator is a deterministic simulated METAR seeded by (ICAO, hour):
 * stable within the hour, varies by airport and over time. In production the
 * same shape is fed by a live METAR/TAF adapter (Aviation Weather API) —
 * consumers do not change (see ROADMAP: Weather Consistency).
 */

export type AirportWeather = {
  icao: string;
  name: string;
  category: "VFR" | "MVFR" | "IFR";
  windDir: number;
  windKt: number;
  gustKt: number | null;
  visibilitySm: number;
  ceilingFt: number | null;
  tempC: number;
  densityAltFt: number;
  risks: string[];
};

export function airportWeather(icao: string, name: string, now: Date): AirportWeather {
  // Deterministic per (airport, hour) so the whole app agrees and dashboards
  // don't flicker between renders.
  const hourSeed = `${icao}:${now.toISOString().slice(0, 13)}`;
  let h = 2166136261;
  for (const c of hourSeed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const pick = (mod: number, off = 0) => ((h = (h * 1103515245 + 12345) >>> 0) % mod) + off;

  const windDir = pick(36) * 10;
  const windKt = pick(18, 3);
  const gustKt = windKt > 14 ? windKt + pick(8, 4) : null;
  const ceilingRoll = pick(10);
  const ceilingFt = ceilingRoll < 2 ? 800 + pick(4) * 100 : ceilingRoll < 4 ? 1500 + pick(15) * 100 : ceilingRoll < 7 ? 4500 + pick(50) * 100 : null;
  const visibilitySm = ceilingFt && ceilingFt < 1000 ? pick(3, 1) : 10;
  const tempC = pick(14, 12);
  const densityAltFt = Math.round(tempC * 120 + pick(400));

  const category: AirportWeather["category"] =
    (ceilingFt !== null && ceilingFt < 1000) || visibilitySm < 3 ? "IFR"
    : (ceilingFt !== null && ceilingFt < 3000) || visibilitySm < 5 ? "MVFR"
    : "VFR";

  const risks: string[] = [];
  if (category === "IFR") risks.push("Below VFR minimums — student solos blocked");
  else if (category === "MVFR") risks.push("Marginal VFR — review student cross-countries");
  if (windKt >= 15) risks.push(`Strong winds ${windKt}${gustKt ? `G${gustKt}` : ""} kt — check student crosswind limits`);
  if (densityAltFt > 2500) risks.push(`Density altitude ${densityAltFt.toLocaleString()} ft — expect degraded climb`);

  return { icao, name, category, windDir, windKt, gustKt, visibilitySm, ceilingFt, tempC, densityAltFt, risks };
}

/** Sky descriptor for compact display (CLR / SCT045 / BKN012 …). */
export function skyOf(w: AirportWeather): string {
  if (w.ceilingFt === null) return "CLR";
  const layer = w.ceilingFt < 1000 ? "OVC" : w.ceilingFt < 3000 ? "BKN" : "SCT";
  return `${layer}${String(Math.round(w.ceilingFt / 100)).padStart(3, "0")}`;
}

/** One-line summary used by the top bar, dashboard and Mission Control. */
export function weatherSummary(w: AirportWeather): string {
  const wind = `${String(w.windDir).padStart(3, "0")}° ${w.windKt}${w.gustKt ? `G${w.gustKt}` : ""}kt`;
  return `${wind} · ${w.visibilitySm}SM · ${skyOf(w)} · ${w.tempC}°C`;
}

export function icaoOf(location: { icao: string | null; name: string }): string {
  return location.icao ?? location.name.slice(0, 4).toUpperCase();
}

/**
 * Weather for the organization's ACTIVE location (per-user location cookie,
 * falling back to the org's first active location). Returns null when the
 * organization has no locations yet.
 */
export async function activeLocationWeather(organizationId: string, activeLocationId?: string | null) {
  const locations = await db.location.findMany({
    where: { organizationId, isActive: true },
    select: { id: true, name: true, icao: true },
    orderBy: { name: "asc" },
  });
  if (!locations.length) return null;
  const active = locations.find((l) => l.id === activeLocationId) ?? locations[0];
  return { location: active, weather: airportWeather(icaoOf(active), active.name, new Date()) };
}
