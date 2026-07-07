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
  "/mission-control": "notifications.view", // everyone — sections inside gate themselves
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

export function isAdmin(role: Role) {
  return role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN";
}

// Display-language only. Keys are the Prisma `Role` enum (the RBAC contract);
// the strings are the aviation-native labels users see. Renaming a value here
// never changes a permission — the enum and permission bundles are untouched.
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Account Owner",
  SCHOOL_ADMIN: "Operations Director",
  DISPATCHER: "Flight Dispatcher",
  INSTRUCTOR: "Flight Instructor",
  STUDENT: "Student Pilot",
  MAINTENANCE: "Maintenance Manager",
  ACCOUNTANT: "Finance Manager",
};

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  FOUNDER: "Founder",
  SOFTWARE_ENGINEER: "Software Engineer",
  PLATFORM_ADMIN: "Platform Administrator",
  CUSTOMER_SUCCESS: "Customer Success",
  SUPPORT_ENGINEER: "Support Engineer",
  BILLING_ADMIN: "Billing Administrator",
  AUDITOR: "Read-Only Auditor",
};
