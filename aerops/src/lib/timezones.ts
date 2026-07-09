/**
 * Curated IANA time zones offered in Settings. Kept small and US-aviation
 * focused on purpose: these are the zones AeroOps supports in the UI today,
 * and the settings/locations APIs validate writes against this exact list so
 * a client can never persist an arbitrary or malformed zone. Add a zone here
 * (value must be a real IANA identifier) to surface it everywhere at once.
 */
export const TIME_ZONES = [
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Mountain (no DST) — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { value: "UTC", label: "UTC — Zulu" },
] as const;

export type TimeZoneValue = (typeof TIME_ZONES)[number]["value"];

const VALUES = new Set(TIME_ZONES.map((t) => t.value));

export function isValidTimeZone(value: string): value is TimeZoneValue {
  return VALUES.has(value as TimeZoneValue);
}
