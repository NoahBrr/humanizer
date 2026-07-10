import type { PlatformRole } from "@prisma/client";

/**
 * The platform-staff permission matrix. Where customer RBAC is a per-org bundle
 * of `Permission` keys (src/lib/permissions.ts), platform staff capabilities are
 * a fixed catalog mapped to the built-in `PlatformRole` enum. This is the single
 * source of truth for "what can an AeroOps staff role do in /platform" — routes
 * derive their allowed-role list from it via `platformRolesWith()` rather than
 * hardcoding role-name arrays, so adding a future role or capability is a data
 * change here, not a hunt through call sites.
 *
 * Convention: a permission is *mutating* iff its key does not end in `.view`.
 * Read-only roles (AUDITOR) hold only `.view` keys — enforced by test.
 */
export const PLATFORM_PERMISSIONS = {
  "platform.dashboard.view": "View the platform operations dashboard",
  "platform.orgs.view": "View customer organizations",
  "platform.orgs.manage": "Create, soft-delete orgs; change plans and modules",
  "platform.orgs.edit": "Edit organization profile fields (name, contact, description, timezone)",
  "platform.orgs.suspend": "Suspend or reactivate organizations",
  "platform.branding.manage": "Upload, replace, or remove organization branding (logo, color)",
  "platform.locations.manage": "Add, edit, or remove organization locations",
  "platform.capacity.manage": "Change organization capacity limits (max aircraft / users)",
  "platform.pricing.view": "View internal pricing, contract terms, and platform notes",
  "platform.pricing.change": "Change internal pricing, subscription status, and contract terms",
  "platform.users.view": "Search and view customer users",
  "platform.users.manage": "Deactivate, reactivate, force-logout customer users; manage memberships",
  "platform.users.transfer_owner": "Transfer an organization's Account Owner",
  "platform.roles.manage": "Change a customer user's role and permissions",
  "platform.impersonate": "Start an audited impersonation session",
  "platform.billing.view": "View subscriptions, invoices, and billing status",
  "platform.security.view": "View platform security signals and events",
  "platform.audit.view": "View the platform audit log",
  "platform.support.tools": "Use support tooling (imports, snapshots, simulation, notes)",
  "platform.imports.manage": "Roll back customer import jobs",
  "platform.system.view": "View system health and infrastructure status",
} as const;

export type PlatformPermission = keyof typeof PLATFORM_PERMISSIONS;

export const ALL_PLATFORM_PERMISSIONS = Object.keys(PLATFORM_PERMISSIONS) as PlatformPermission[];

/** A capability is mutating unless it is a pure `.view`. */
export function isMutatingPlatformPermission(p: PlatformPermission): boolean {
  return !p.endsWith(".view");
}

const VIEW_ONLY: PlatformPermission[] = ALL_PLATFORM_PERMISSIONS.filter((p) => !isMutatingPlatformPermission(p));

/**
 * Role → capabilities. FOUNDER is the platform super admin (everything).
 * AUDITOR is read-only (every `.view`, nothing mutating). The others are scoped
 * to their function. Spec role names map onto these via PLATFORM_ROLE_SPEC_ALIAS.
 */
export const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  // Platform Super Admin — the full console.
  FOUNDER: [...ALL_PLATFORM_PERMISSIONS],
  // Platform Administrator — full operational management.
  PLATFORM_ADMIN: [...ALL_PLATFORM_PERMISSIONS],
  // Platform Security — technical + security + system; may impersonate to debug,
  // but not manage billing, org lifecycle, ownership, or roles.
  SOFTWARE_ENGINEER: [
    "platform.dashboard.view", "platform.orgs.view", "platform.users.view",
    "platform.security.view", "platform.audit.view", "platform.system.view",
    "platform.support.tools", "platform.imports.manage", "platform.impersonate",
  ],
  // Customer Success — read + light support; read-only outreach role.
  CUSTOMER_SUCCESS: [
    "platform.dashboard.view", "platform.orgs.view", "platform.users.view",
    "platform.audit.view", "platform.support.tools", "platform.impersonate",
  ],
  // Platform Support — user lifecycle help + support tooling + impersonation,
  // plus onboarding help (edit profile, branding, locations). Not ownership
  // transfer, role changes, billing/pricing, or org lifecycle.
  SUPPORT_ENGINEER: [
    "platform.dashboard.view", "platform.orgs.view", "platform.orgs.edit",
    "platform.branding.manage", "platform.locations.manage",
    "platform.users.view", "platform.users.manage", "platform.support.tools",
    "platform.impersonate", "platform.imports.manage", "platform.audit.view",
  ],
  // Platform Billing — subscriptions, plans, pricing, capacity, org lifecycle
  // for commercial reasons.
  BILLING_ADMIN: [
    "platform.dashboard.view", "platform.orgs.view", "platform.orgs.manage",
    "platform.orgs.edit", "platform.orgs.suspend", "platform.capacity.manage",
    "platform.pricing.view", "platform.pricing.change",
    "platform.users.view", "platform.billing.view", "platform.audit.view",
  ],
  // Platform Read Only — every read surface, no mutations.
  AUDITOR: [...VIEW_ONLY],
};

/** Spec-facing display names for the idealized six platform roles (+ extras). */
export const PLATFORM_ROLE_SPEC_ALIAS: Record<PlatformRole, string> = {
  FOUNDER: "Platform Super Admin",
  PLATFORM_ADMIN: "Platform Administrator",
  SUPPORT_ENGINEER: "Platform Support",
  BILLING_ADMIN: "Platform Billing",
  SOFTWARE_ENGINEER: "Platform Security",
  AUDITOR: "Platform Read Only",
  CUSTOMER_SUCCESS: "Customer Success",
};

export function platformPermissionsFor(role: PlatformRole): ReadonlySet<PlatformPermission> {
  return new Set(PLATFORM_ROLE_PERMISSIONS[role]);
}

export function platformCan(role: PlatformRole | undefined, permission: PlatformPermission): boolean {
  if (!role) return false;
  return PLATFORM_ROLE_PERMISSIONS[role].includes(permission);
}

/**
 * The roles that hold a capability — the array an API route passes to
 * `authorizePlatform(...)`. Throws on an unknown key (would otherwise silently
 * pass `[]`, and `authorizePlatform([])` locks *everyone* out). By construction
 * every catalogued permission is held by at least one role (asserted by test).
 */
export function platformRolesWith(permission: PlatformPermission): PlatformRole[] {
  if (!(permission in PLATFORM_PERMISSIONS)) {
    throw new Error(`Unknown platform permission: ${permission}`);
  }
  const roles = (Object.keys(PLATFORM_ROLE_PERMISSIONS) as PlatformRole[]).filter((r) =>
    PLATFORM_ROLE_PERMISSIONS[r].includes(permission),
  );
  if (roles.length === 0) throw new Error(`No platform role grants ${permission}`);
  return roles;
}
