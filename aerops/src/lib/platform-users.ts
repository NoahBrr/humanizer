import type { Role } from "@prisma/client";
import { permissionsForRole, type Permission } from "@/lib/permissions";

/**
 * Pure decision rules for platform-staff actions on customer users. Kept
 * import-free of server-only modules so the test suite exercises them directly
 * (mirrors src/lib/session-rules.ts). The API route computes the DB facts;
 * these functions decide whether the action is allowed.
 */

/**
 * The role the new Account Owner is promoted to on transfer: ACCOUNT_OWNER
 * (ADR-023). Ownership is the source of truth on `Organization.ownerId` AND the
 * new owner's active ACCOUNT_OWNER membership — kept in lockstep by the
 * ownership-transfer service (lib/memberships.ts), never a plain role edit.
 */
export const PROMOTE_ROLE: Role = "ACCOUNT_OWNER";

/**
 * The role a former Account Owner is demoted to on transfer — a broad
 * Organization Administrator (full permissions, no ownership). They keep an
 * authorized role in the org rather than being orphaned.
 */
export const DEMOTE_ROLE: Role = "SCHOOL_ADMIN";

/**
 * Whether a built-in role may be assigned through the ordinary role-change flow.
 * ACCOUNT_OWNER is refused here: ownership is conferred only through the
 * dedicated transfer workflow (Part 8 / Part 10). SUPER_ADMIN is the retired
 * legacy value and is never assignable.
 */
export function canAssignRoleDirectly(role: Role): { ok: boolean; reason?: string } {
  if (role === "ACCOUNT_OWNER") {
    return { ok: false, reason: "Account Owner is assigned only through the ownership-transfer workflow, not as an ordinary role." };
  }
  if (role === "SUPER_ADMIN") {
    return { ok: false, reason: "SUPER_ADMIN is a retired role and can no longer be assigned." };
  }
  return { ok: true };
}

/**
 * Effective permissions for a user, matching orgSessionFor(): a custom role's
 * bundle wins; otherwise the built-in role's defaults. Shared so the platform
 * "effective permissions" panel can never drift from what the session grants.
 */
export function resolvePermissions(role: Role, customRolePermissions?: readonly string[] | null): ReadonlySet<Permission> {
  if (customRolePermissions) return new Set(customRolePermissions as Permission[]);
  return permissionsForRole(role);
}

/** Effective org administrator = can manage settings (the owner / SCHOOL_ADMIN tier). */
export function isEffectiveAdmin(permissions: ReadonlySet<Permission>): boolean {
  return permissions.has("settings.manage");
}

export type DeactivateContext = { isOwner: boolean; isLastActiveAdmin: boolean; isDeleted: boolean };

/** Whether a customer user may be deactivated by platform staff. */
export function canDeactivateUser(ctx: DeactivateContext): { ok: boolean; reason?: string } {
  if (ctx.isDeleted) return { ok: false, reason: "This user is already deleted." };
  if (ctx.isOwner) return { ok: false, reason: "Transfer the Account Owner role to another member before deactivating this user." };
  if (ctx.isLastActiveAdmin) return { ok: false, reason: "This is the organization's last active administrator — deactivating them would lock the org out." };
  return { ok: true };
}

/** Reactivation is only for deactivated users; a soft-deleted user is not revived here. */
export function canReactivateUser(ctx: { isDeleted: boolean }): { ok: boolean; reason?: string } {
  if (ctx.isDeleted) return { ok: false, reason: "This user was soft-deleted, not deactivated — deletion is not reversible from here." };
  return { ok: true };
}

export type NewOwnerContext = { exists: boolean; isActive: boolean; isDeleted: boolean; sameOrg: boolean };

/** Whether ownership may be transferred to the proposed new owner. */
export function canTransferOwnerTo(ctx: NewOwnerContext): { ok: boolean; reason?: string } {
  if (!ctx.exists || !ctx.sameOrg) return { ok: false, reason: "The new owner must be an existing member of this organization." };
  if (!ctx.isActive || ctx.isDeleted) return { ok: false, reason: "The new owner must be an active member." };
  return { ok: true };
}

/**
 * Whether a user's role may be changed via the ordinary role-change flow. The
 * Account Owner's role is locked (changing it would silently demote ownership —
 * transfer ownership instead), and ACCOUNT_OWNER can never be assigned this way.
 */
export function canChangeRole(ctx: { isOwner: boolean; targetRole: Role }): { ok: boolean; reason?: string } {
  if (ctx.isOwner) return { ok: false, reason: "This user is the Account Owner — transfer ownership before changing their role." };
  return canAssignRoleDirectly(ctx.targetRole);
}
