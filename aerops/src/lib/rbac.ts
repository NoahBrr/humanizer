import type { PlatformRole, Role } from "@prisma/client";
import type { Permission } from "@/lib/permissions";
import { SECTION_MODULES, type ModuleKey } from "@/lib/features";

/**
 * Section-level access: each app section is gated by one permission key and
 * (optionally) a feature module. Both are data-driven — permissions come from
 * the user's role bundle, modules from the org's plan and overrides.
 */
export const SECTION_PERMISSIONS: Record<string, Permission> = {
  "/dashboard": "notifications.view", // everyone in the org
  "/mission-control": "aircraft.view", // ops staff — the live wall; hidden from Student Pilots & Finance
  "/intelligence": "students.view",
  "/schedule": "schedule.view",
  "/operations": "dispatch.release",
  "/dispatch": "dispatch.release",
  "/aircraft": "aircraft.view",
  "/training": "students.manage",
  "/students": "students.view",
  "/instructors": "instructors.view",
  "/crm": "students.manage",
  "/maintenance": "maintenance.view",
  "/billing": "billing.view",
  "/reports": "reports.view",
  "/executive": "reports.view",
  "/notifications": "notifications.view",
  "/documents": "documents.view",
  "/import": "data.import",
  "/settings": "settings.manage",
};

export function canAccessSection(
  permissions: ReadonlySet<Permission>,
  modules: Set<ModuleKey>,
  sectionHref: string,
): boolean {
  const perm = SECTION_PERMISSIONS[sectionHref];
  if (perm && !permissions.has(perm)) return false;
  const mod = SECTION_MODULES[sectionHref];
  if (mod && !modules.has(mod)) return false;
  return true;
}

/** Broad organization administrator (or owner). Owners (ACCOUNT_OWNER) and
 *  Organization Administrators (SCHOOL_ADMIN) both qualify; SUPER_ADMIN is the
 *  retained legacy value. Ownership itself keys on Organization.ownerId, never
 *  on this check (ADR-023). */
export function isAdmin(role: Role) {
  return role === "ACCOUNT_OWNER" || role === "SCHOOL_ADMIN" || role === "SUPER_ADMIN";
}

// Display-language only. Keys are the Prisma `Role` enum (the RBAC contract);
// the strings are the aviation-native labels users see. Renaming a value here
// never changes a permission — the enum and permission bundles are untouched.
export const ROLE_LABELS: Record<Role, string> = {
  ACCOUNT_OWNER: "Account Owner",
  // Deprecated legacy value (ADR-023); no customer holds it after the D2 migration.
  SUPER_ADMIN: "Account Owner (legacy)",
  SCHOOL_ADMIN: "Organization Administrator",
  DISPATCHER: "Flight Dispatcher",
  INSTRUCTOR: "Flight Instructor",
  STUDENT: "Student Pilot",
  MAINTENANCE: "Maintenance Manager",
  ACCOUNTANT: "Finance Manager",
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  FOUNDER_SUPER_ADMIN: "Founder Super Admin",
  FOUNDER: "Platform Admin Plus",
  SOFTWARE_ENGINEER: "Software Engineer",
  PLATFORM_ADMIN: "Platform Administrator",
  CUSTOMER_SUCCESS: "Customer Success",
  SUPPORT_ENGINEER: "Support Engineer",
  BILLING_ADMIN: "Billing Administrator",
  AUDITOR: "Read-Only Auditor",
};
