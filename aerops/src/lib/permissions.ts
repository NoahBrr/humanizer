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
  // --- Revenue Engine (Phase 1, doc 36 §1). Module-gate to `billing` via the
  // --- single MODULE_BY_PREFIX(revenue → billing) entry in session.ts. Most
  // --- routes light up in later phases; the keys are data now so bundles and
  // --- custom OrgRoles are stable from the start.
  "revenue.review_view": "View Revenue Reviews (instructors: own only)",
  "revenue.review_create": "Create manual Revenue Reviews (instructors: own sessions)",
  "revenue.review_submit": "Submit a review for approval; resubmit after changes",
  "revenue.review_edit": "Edit charges/lines pre-approval (not instructor time)",
  "revenue.approve": "Approve reviews (operations/second), request changes, escalate",
  "revenue.approve_routine": "Instructor self-approval of routine reviews (policy-gated)",
  "revenue.approve_finance": "Record the finance approval; set accounting closed-through",
  "revenue.charge": "Initiate/retry/cancel a charge; run the due-payments pass",
  "revenue.void": "Void a review pre-approval, or post-approval while uncharged",
  "revenue.refund": "Request refunds and partial refunds",
  "revenue.refund_approve": "Approve refunds; retry/cancel failed refunds",
  "revenue.dispute_manage": "Attach evidence and record dispute outcomes",
  "revenue.adjust": "Create/request discounts, waivers, credits, corrections, transfers",
  "revenue.adjust_approve": "Approve/reject/apply adjustments; act as second approver",
  "revenue.promo_manage": "Create/edit/deactivate promo codes",
  "revenue.time_entry": "Enter/edit/confirm own instructor time",
  "revenue.time_override": "Enter/override any instructor's time (reason required)",
  "revenue.pricing_view": "View aircraft pricing profiles and resolution reasons",
  "revenue.pricing_manage": "Create/edit draft pricing profiles and versions",
  "revenue.pricing_approve": "Approve/supersede pricing profiles",
  "revenue.rates_view": "View instructor billing-rate profiles",
  "revenue.rates_manage": "Create/edit draft billing-rate profiles",
  "revenue.rates_approve": "Approve/supersede/archive billing-rate profiles",
  "revenue.items_manage": "Manage the Revenue Item catalog",
  "revenue.taxes_manage": "Create/version tax rules; change org tax settings",
  "revenue.payment_methods_manage": "Start hosted method setup on a payer's behalf; detach methods",
  "revenue.payment_policy_manage": "Edit payment timing and collection policy",
  "revenue.financial_hold_manage": "Place and lift financial holds",
  "revenue.connect_manage": "Manage Stripe Connect onboarding and status sync",
  "revenue.allocation_view": "See allocation totals incl. platform fee and compensation",
  "revenue.compensation_view": "View all Instructor Compensation records and reports",
  "revenue.compensation_view_own": "View only own earnings and rates",
  "revenue.compensation_approve": "Approve/release earnings; decide clawbacks",
  "revenue.compensation_manage": "Manage compensation profiles, classification, manual earnings",
  "revenue.reconciliation_manage": "View/resolve reconciliation exceptions",
  "revenue.exports_run": "Create/download financial exports; manage accounting mappings",
  "revenue.self_view": "See own financials only (My Payments / student self-view)",
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
    // Revenue Engine (doc 36 §3.1). NOTE: doc 36 also recommends adding
    // `billing.view` to DISPATCHER (the D34 fix) but §13 D34 is an OPEN
    // product-owner question and adding it flips the `role-visibility`
    // "Dispatcher: finance no" contract, so it is DEFERRED to owner sign-off.
    "revenue.review_view", "revenue.rates_view", "revenue.pricing_view",
  ],
  INSTRUCTOR: [
    ...BASE,
    "schedule.view", "schedule.create", "schedule.edit",
    "dispatch.release", "dispatch.close",
    "aircraft.view",
    "students.view", "students.manage",
    "instructors.view",
    // Revenue Engine — own reviews/time/compensation (engine-scoped), doc 36 §3.1
    "revenue.review_view", "revenue.review_create", "revenue.review_submit",
    "revenue.time_entry", "revenue.compensation_view_own", "revenue.pricing_view",
  ],
  STUDENT: [...BASE, "schedule.view", "revenue.self_view"],
  MAINTENANCE: [...BASE, "aircraft.view", "aircraft.ground", "maintenance.view", "maintenance.manage"],
  ACCOUNTANT: [
    ...BASE, "billing.view", "billing.record_payments", "reports.view", "reports.export",
    // Finance Manager: finalizer, not a unilateral operations approver — holds
    // approve_finance (not revenue.approve), per doc 36 §3.1 + §13 note 3.
    "revenue.review_view", "revenue.review_create", "revenue.approve_finance",
    "revenue.charge", "revenue.refund", "revenue.refund_approve", "revenue.dispute_manage",
    "revenue.adjust", "revenue.adjust_approve",
    "revenue.pricing_view", "revenue.pricing_manage", "revenue.rates_view", "revenue.rates_manage",
    "revenue.items_manage", "revenue.taxes_manage", "revenue.payment_methods_manage",
    "revenue.allocation_view", "revenue.compensation_view", "revenue.compensation_view_own",
    "revenue.compensation_approve", "revenue.reconciliation_manage", "revenue.exports_run",
  ],
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
