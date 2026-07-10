import type { PlatformRole } from "@prisma/client";

/**
 * Pure decision rules for founder actions on Platform Users (D3-A / ADR-024),
 * kept import-free of server-only modules so the test suite exercises them
 * directly. The API route computes the DB facts; these functions decide whether
 * a founder action is allowed. Founder identity (`isFounder`) is conferred only
 * by the bootstrap and can never be granted by assigning a role.
 */

/**
 * Platform roles assignable through the ordinary role-change flow.
 * FOUNDER_SUPER_ADMIN is excluded: founder authority is the immutable `isFounder`
 * identity set by the bootstrap, never a role you assign (so no one can grant
 * themselves founder power by editing a role).
 */
export const ASSIGNABLE_PLATFORM_ROLES: PlatformRole[] = [
  "FOUNDER", "PLATFORM_ADMIN", "SOFTWARE_ENGINEER", "CUSTOMER_SUCCESS", "SUPPORT_ENGINEER", "BILLING_ADMIN", "AUDITOR",
];

export function canAssignPlatformRoleDirectly(role: PlatformRole): { ok: boolean; reason?: string } {
  if (role === "FOUNDER_SUPER_ADMIN") {
    return { ok: false, reason: "Founder Super Admin is conferred only by the founder bootstrap, not by assigning a role." };
  }
  return { ok: true };
}

/**
 * Last-founder safeguard: a founder cannot be deactivated or have their platform
 * access removed unless another Founder Super Admin remains active.
 */
export function canDeactivatePlatformUser(ctx: { targetIsFounder: boolean; otherActiveFoundersExist: boolean }): { ok: boolean; reason?: string } {
  if (ctx.targetIsFounder && !ctx.otherActiveFoundersExist) {
    return { ok: false, reason: "This is the last active Founder Super Admin — another founder must remain active before this one can be removed or deactivated." };
  }
  return { ok: true };
}

/**
 * Any change to a founder (by another founder) requires an explicit recorded
 * reason — the founder-to-founder audit + recovery safeguard.
 */
export function requiresFounderChangeReason(targetIsFounder: boolean, reason: string | undefined): { ok: boolean; reason?: string } {
  if (targetIsFounder && (!reason || reason.trim().length < 3)) {
    return { ok: false, reason: "Changing a Founder Super Admin requires a recorded reason." };
  }
  return { ok: true };
}

/** An access window is valid only when expiration is after the start. */
export function validAccessWindow(startsAt: Date | null | undefined, expiresAt: Date | null | undefined): { ok: boolean; reason?: string } {
  if (startsAt && expiresAt && expiresAt.getTime() <= startsAt.getTime()) {
    return { ok: false, reason: "Access expiration must be after the access start." };
  }
  return { ok: true };
}

/**
 * Whether a platform user may be given access scopes (read-only, time-boxed
 * access, org restriction). These apply to NON-FOUNDER staff only. A founder is
 * the platform's ultimate authority and must never be read-only, expiring, or
 * org-restricted — doing so (especially on the last founder, or on oneself)
 * could irrecoverably lock founders out with no recovery path. So scoping a
 * founder is refused outright.
 */
export function canScopePlatformUser(targetIsFounder: boolean): { ok: boolean; reason?: string } {
  if (targetIsFounder) {
    return { ok: false, reason: "Founder Super Admins cannot be made read-only, time-boxed, or org-restricted — founder access must never be lockable." };
  }
  return { ok: true };
}
