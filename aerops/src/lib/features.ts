/**
 * Feature-flag layer. Modules exist at two levels: a subscription plan lists
 * what an organization MAY use; the organization's disabledModules (set by
 * platform admins or the org itself) subtracts from that. Core modules are
 * always on — the product is meaningless without them.
 */
export const MODULES = {
  scheduling: "Scheduling",
  dispatch: "Dispatch",
  maintenance: "Maintenance",
  billing: "Billing",
  reports: "Reports & Analytics",
  documents: "Document Vault",
  ai_copilot: "AI Copilot",
  inventory: "Inventory",
  flight_following: "Flight Following",
  weather: "Weather",
} as const;

export type ModuleKey = keyof typeof MODULES;

export const CORE_MODULES: ModuleKey[] = ["scheduling", "dispatch"];

export function enabledModules(planModules: string[] | undefined, disabledModules: string[], profileModules?: Set<string> | null): Set<ModuleKey> {
  const available = new Set<string>([...CORE_MODULES, ...(planModules ?? Object.keys(MODULES))]);
  // Business profiles narrow the plan to what the org actually does.
  if (profileModules) {
    for (const m of [...available]) {
      if (!profileModules.has(m) && !CORE_MODULES.includes(m as ModuleKey)) available.delete(m);
    }
  }
  for (const d of disabledModules) {
    if (!CORE_MODULES.includes(d as ModuleKey)) available.delete(d);
  }
  return available as Set<ModuleKey>;
}

/** Which module gates each app section. Sections not listed are always on. */
export const SECTION_MODULES: Record<string, ModuleKey> = {
  "/schedule": "scheduling",
  "/operations": "dispatch",
  "/dispatch": "dispatch",
  "/maintenance": "maintenance",
  "/billing": "billing",
  "/reports": "reports",
  "/documents": "documents",
};
