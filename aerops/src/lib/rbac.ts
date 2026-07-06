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
  "/schedule": "schedule.view",
  "/dispatch": "dispatch.release",
  "/aircraft": "aircraft.view",
  "/training": "students.manage",
  "/students": "students.view",
  "/instructors": "instructors.view",
  "/maintenance": "maintenance.view",
  "/billing": "billing.view",
  "/reports": "reports.view",
  "/notifications": "notifications.view",
  "/documents": "documents.view",
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

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Administrator",
  SCHOOL_ADMIN: "School Administrator",
  DISPATCHER: "Dispatcher",
  INSTRUCTOR: "Instructor",
  STUDENT: "Student",
  MAINTENANCE: "Maintenance",
  ACCOUNTANT: "Accountant",
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
