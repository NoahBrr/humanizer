import type { Role } from "@prisma/client";

/**
 * The permission catalog. Every capability in AeroOps is one of these keys;
 * roles (built-in or custom) are just bundles of them. API routes and pages
 * check permissions — never role names — so organizations can reshape roles
 * without code changes.
 */
export const PERMISSIONS = {
  "schedule.view": "View the schedule",
  "schedule.create": "Create bookings",
  "schedule.edit": "Edit and move bookings",
  "schedule.delete": "Delete bookings",
  "schedule.override_conflicts": "Override scheduling conflicts",
  "dispatch.release": "Release flights (pre-flight)",
  "dispatch.close": "Close flights (post-flight)",
  "aircraft.view": "View aircraft",
  "aircraft.manage": "Manage aircraft profiles",
  "aircraft.ground": "Ground / return aircraft to line",
  "maintenance.view": "View maintenance",
  "maintenance.manage": "Manage squawks and work orders",
  "students.view": "View students",
  "students.manage": "Manage student training records",
  "instructors.view": "View instructors",
  "billing.view": "View financials",
  "billing.record_payments": "Record payments",
  "reports.view": "View reports",
  "reports.export": "Export data",
  "documents.view": "View documents",
  "documents.manage": "Manage documents",
  "notifications.view": "View notifications",
  "users.manage": "Manage users and invitations",
  "settings.manage": "Manage organization settings",
  "data.import": "Import data",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const BASE: Permission[] = ["notifications.view", "documents.view"];

/**
 * Default permission bundles for the built-in roles. Seeded into each org as
 * system OrgRoles and used as the fallback when a user has no custom role.
 *
 * ACCOUNT_OWNER carries every permission — the ultimate authority within one
 * organization (ADR-023). SUPER_ADMIN is retained only as a DEPRECATED legacy
 * value (no code assigns it to a customer; the D2 migration moved every row off
 * it). SCHOOL_ADMIN is the Organization Administrator: full permissions, no
 * ownership.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ACCOUNT_OWNER: ALL_PERMISSIONS,
  SUPER_ADMIN: ALL_PERMISSIONS,
  SCHOOL_ADMIN: ALL_PERMISSIONS,
  DISPATCHER: [
    ...BASE,
    "schedule.view", "schedule.create", "schedule.edit", "schedule.delete", "schedule.override_conflicts",
    "dispatch.release", "dispatch.close",
    "aircraft.view", "aircraft.ground",
    "maintenance.view", "maintenance.manage",
    "students.view", "instructors.view",
    "billing.record_payments",
    "reports.view", "reports.export",
  ],
  INSTRUCTOR: [
    ...BASE,
    "schedule.view", "schedule.create", "schedule.edit",
    "dispatch.release", "dispatch.close",
    "aircraft.view",
    "students.view", "students.manage",
    "instructors.view",
  ],
  STUDENT: [...BASE, "schedule.view"],
  MAINTENANCE: [...BASE, "aircraft.view", "aircraft.ground", "maintenance.view", "maintenance.manage"],
  ACCOUNTANT: [...BASE, "billing.view", "billing.record_payments", "reports.view", "reports.export"],
};

export function permissionsForRole(role: Role): ReadonlySet<Permission> {
  return new Set(DEFAULT_ROLE_PERMISSIONS[role]);
}

/**
 * Built-in roles seeded as assignable system OrgRoles for a new organization.
 * Excludes ACCOUNT_OWNER (conferred only through the ownership workflow, never
 * a role you assign) and the deprecated SUPER_ADMIN. Single source so the org
 * creation sites (onboarding, platform wizard, demo generator) never drift.
 */
export const ASSIGNABLE_SYSTEM_ROLES: Role[] = [
  "SCHOOL_ADMIN", "DISPATCHER", "INSTRUCTOR", "STUDENT", "MAINTENANCE", "ACCOUNTANT",
];

/** The seed payload for a new org's system OrgRoles (see ASSIGNABLE_SYSTEM_ROLES). */
export function systemOrgRoleSeed(): { name: string; permissions: Permission[]; isSystem: true }[] {
  return ASSIGNABLE_SYSTEM_ROLES.map((name) => ({
    name,
    permissions: [...DEFAULT_ROLE_PERMISSIONS[name]],
    isSystem: true,
  }));
}

/** True for roles that confer or historically implied ultimate org authority. */
export function isOwnerTierRole(role: Role): boolean {
  return role === "ACCOUNT_OWNER" || role === "SUPER_ADMIN";
}
