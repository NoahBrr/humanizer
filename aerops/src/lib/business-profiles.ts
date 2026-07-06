import { CORE_MODULES, type ModuleKey } from "@/lib/features";

/**
 * Business Profiles (Section 8): additive activity sets, never exclusive
 * types. Each profile declares the modules it REQUIRES; activating profiles
 * resolves the union of their dependencies. "What does this company do?" —
 * never "what kind of company is this?".
 *
 * Adding a new aviation business = one entry here + its module set.
 * No migrations, no rewrites.
 */
export const BUSINESS_PROFILES = {
  part_61: { label: "Part 61 Flight Training", modules: ["scheduling", "dispatch", "billing", "documents", "maintenance", "reports"] },
  part_141: { label: "Part 141 Flight Training", modules: ["scheduling", "dispatch", "billing", "documents", "maintenance", "reports"] },
  university: { label: "University Aviation Program", modules: ["scheduling", "dispatch", "billing", "documents", "maintenance", "reports"] },
  flying_club: { label: "Flying Club", modules: ["scheduling", "dispatch", "billing", "documents"] },
  aircraft_rental: { label: "Aircraft Rental", modules: ["scheduling", "dispatch", "billing"] },
  discovery_flights: { label: "Discovery Flight Center", modules: ["scheduling", "dispatch", "billing"] },
  ground_school: { label: "Ground School", modules: ["scheduling", "documents"] },
  aircraft_management: { label: "Aircraft Management", modules: ["scheduling", "maintenance", "billing", "reports", "documents"] },
  corporate: { label: "Corporate Flight Department", modules: ["scheduling", "dispatch", "maintenance", "documents", "reports"] },
  charter_135: { label: "Charter Operations (Part 135)", modules: ["scheduling", "dispatch", "maintenance", "billing", "documents", "reports"] },
  fbo: { label: "FBO", modules: ["scheduling", "billing", "reports", "inventory"] },
  maintenance_145: { label: "Maintenance Facility (Part 145)", modules: ["maintenance", "billing", "documents", "inventory"] },
  fuel_sales: { label: "Fuel Sales", modules: ["billing", "inventory", "reports"] },
  hangar_rental: { label: "Hangar Rental", modules: ["billing", "documents"] },
} as const satisfies Record<string, { label: string; modules: string[] }>;

export type BusinessProfileKey = keyof typeof BUSINESS_PROFILES;

export function isProfileKey(key: string): key is BusinessProfileKey {
  return key in BUSINESS_PROFILES;
}

/**
 * Resolve the module set required by a combination of profiles (dependencies
 * install automatically). Core modules are always present. An empty profile
 * list means "no restriction" — every plan module stays available, which is
 * also the backward-compatible behavior for orgs that predate profiles.
 */
export function modulesForProfiles(profiles: string[]): Set<string> | null {
  const valid = profiles.filter(isProfileKey);
  if (valid.length === 0) return null;
  const out = new Set<string>(CORE_MODULES as readonly ModuleKey[]);
  for (const key of valid) for (const m of BUSINESS_PROFILES[key].modules) out.add(m);
  return out;
}
