import "server-only";
import type { Prisma, Role, MembershipStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { DEMOTE_ROLE } from "@/lib/platform-users";
import { selectActiveMembership } from "@/lib/membership-rules";

/**
 * Membership + ownership service layer (ADR-023).
 *
 * `Membership` is the source of truth for a user's organization affiliations,
 * roles, and ownership, and supports one user belonging to many organizations.
 * `User.organizationId`/`role`/`customRoleId`/`primaryLocationId`/`departmentId`
 * are a MAINTAINED PROJECTION of the user's currently-active membership, so the
 * single-org operational core (scheduling, dispatch, billing, tenant isolation
 * from the session) keeps working unchanged. Every function here that mutates a
 * membership re-projects, so the two never drift.
 *
 * The ownership invariant, enforced by these services and asserted by tests:
 * for every organization with an `ownerId`, that user has exactly one ACTIVE
 * membership in the org with role ACCOUNT_OWNER, and no other membership in the
 * org holds ACCOUNT_OWNER. Ownership changes go through `assignOwnerTx` /
 * `transferOwnershipTx` — never a bare role or profile edit.
 *
 * All primitives take a transaction client so callers compose them atomically
 * (the org-creation wizard builds org + owner + roles in one transaction). The
 * `Tx` alias also accepts the base client for single-call convenience.
 */
export type Tx = Prisma.TransactionClient;

/**
 * Recompute the User projection from the user's active memberships. Selection is
 * deterministic: the preferred org (if an active member there) → the current
 * home org (if still active) → the earliest-joined active membership → none.
 * When the user has no active membership they become an individual account
 * (organizationId null); `role` is left at its last value since the column is
 * non-nullable and individual sessions carry no permissions anyway.
 */
export async function projectActiveMembership(tx: Tx, userId: string, preferOrgId?: string): Promise<void> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  const memberships = await tx.membership.findMany({
    where: { userId, status: "ACTIVE", organization: { deletedAt: null, status: { not: "DELETED" } } },
    orderBy: { createdAt: "asc" },
  });
  const target = selectActiveMembership(memberships, user?.organizationId, preferOrgId);

  await tx.user.update({
    where: { id: userId },
    data: target
      ? {
          organizationId: target.organizationId,
          role: target.role,
          customRoleId: target.customRoleId,
          primaryLocationId: target.primaryLocationId,
          departmentId: target.departmentId,
        }
      : { organizationId: null, customRoleId: null, primaryLocationId: null, departmentId: null },
  });
}

/**
 * Make `userId` the Account Owner of `organizationId`: an active ACCOUNT_OWNER
 * membership, `Organization.ownerId`, and the projection — atomically. Used when
 * provisioning a brand-new organization for an existing user (wizard, self-serve,
 * seed). The caller has already validated the user.
 */
export async function assignOwnerTx(
  tx: Tx,
  args: { organizationId: string; userId: string; invitedByLabel?: string; primaryLocationId?: string | null },
): Promise<void> {
  await tx.membership.upsert({
    where: { userId_organizationId: { userId: args.userId, organizationId: args.organizationId } },
    update: { role: "ACCOUNT_OWNER", status: "ACTIVE", deactivatedAt: null, primaryLocationId: args.primaryLocationId ?? undefined },
    create: {
      userId: args.userId,
      organizationId: args.organizationId,
      role: "ACCOUNT_OWNER",
      status: "ACTIVE",
      invitedByLabel: args.invitedByLabel,
      primaryLocationId: args.primaryLocationId ?? undefined,
    },
  });
  await tx.organization.update({ where: { id: args.organizationId }, data: { ownerId: args.userId } });
  await projectActiveMembership(tx, args.userId, args.organizationId);
}

/**
 * Transfer ownership of `organizationId` to `toUserId` (an existing active
 * member). Demotes the former owner to a broad Organization Administrator so
 * they keep an authorized role, promotes the new owner to ACCOUNT_OWNER, and
 * moves `Organization.ownerId` — all atomically. Guarded by the caller
 * (`canTransferOwnerTo` + last-owner rules).
 */
export async function transferOwnershipTx(
  tx: Tx,
  args: { organizationId: string; toUserId: string; demoteRole?: Role },
): Promise<{ fromUserId: string | null; toUserId: string }> {
  const org = await tx.organization.findUnique({ where: { id: args.organizationId }, select: { ownerId: true } });
  const fromUserId = org?.ownerId ?? null;

  if (fromUserId && fromUserId !== args.toUserId) {
    await tx.membership.updateMany({
      where: { userId: fromUserId, organizationId: args.organizationId },
      data: { role: args.demoteRole ?? DEMOTE_ROLE, customRoleId: null, status: "ACTIVE", deactivatedAt: null },
    });
    await projectActiveMembership(tx, fromUserId, args.organizationId);
  }

  await tx.membership.upsert({
    where: { userId_organizationId: { userId: args.toUserId, organizationId: args.organizationId } },
    update: { role: "ACCOUNT_OWNER", customRoleId: null, status: "ACTIVE", deactivatedAt: null },
    create: { userId: args.toUserId, organizationId: args.organizationId, role: "ACCOUNT_OWNER", status: "ACTIVE" },
  });
  await tx.organization.update({ where: { id: args.organizationId }, data: { ownerId: args.toUserId } });
  await projectActiveMembership(tx, args.toUserId, args.organizationId);

  return { fromUserId, toUserId: args.toUserId };
}

/**
 * Create or reactivate a NON-owner membership (Part 8). ACCOUNT_OWNER is refused
 * here — ownership is conferred only through `assignOwnerTx`/`transferOwnershipTx`.
 * The user is not re-homed if they already belong to an org (their active org is
 * preserved); an org-less individual becomes homed to the new org.
 */
export async function addMembershipTx(
  tx: Tx,
  args: {
    userId: string;
    organizationId: string;
    role: Role;
    customRoleId?: string | null;
    primaryLocationId?: string | null;
    departmentId?: string | null;
    invitedByLabel?: string;
    approvedByLabel?: string;
  },
) {
  if (args.role === "ACCOUNT_OWNER") {
    throw new Error("addMembership cannot assign ACCOUNT_OWNER — use the ownership-transfer workflow.");
  }
  const membership = await tx.membership.upsert({
    where: { userId_organizationId: { userId: args.userId, organizationId: args.organizationId } },
    update: {
      role: args.role,
      customRoleId: args.customRoleId ?? null,
      status: "ACTIVE",
      deactivatedAt: null,
      primaryLocationId: args.primaryLocationId ?? undefined,
      departmentId: args.departmentId ?? undefined,
      approvedByLabel: args.approvedByLabel,
    },
    create: {
      userId: args.userId,
      organizationId: args.organizationId,
      role: args.role,
      customRoleId: args.customRoleId ?? null,
      primaryLocationId: args.primaryLocationId ?? undefined,
      departmentId: args.departmentId ?? undefined,
      invitedByLabel: args.invitedByLabel,
      approvedByLabel: args.approvedByLabel,
    },
  });
  await projectActiveMembership(tx, args.userId);
  return membership;
}

/** Set a membership's status (deactivate/reactivate) and re-project. Owner
 *  protection is the caller's responsibility (last-owner rules). */
export async function setMembershipStatusTx(
  tx: Tx,
  args: { userId: string; organizationId: string; status: MembershipStatus },
): Promise<void> {
  await tx.membership.updateMany({
    where: { userId: args.userId, organizationId: args.organizationId },
    data: { status: args.status, deactivatedAt: args.status === "DEACTIVATED" ? new Date() : null },
  });
  await projectActiveMembership(tx, args.userId);
}

/** Change a membership's built-in role (clears any custom role) and re-project.
 *  Owner protection and ACCOUNT_OWNER refusal are the caller's responsibility. */
export async function setMembershipRoleTx(
  tx: Tx,
  args: { userId: string; organizationId: string; role: Role },
): Promise<void> {
  await tx.membership.upsert({
    where: { userId_organizationId: { userId: args.userId, organizationId: args.organizationId } },
    update: { role: args.role, customRoleId: null, status: "ACTIVE" },
    create: { userId: args.userId, organizationId: args.organizationId, role: args.role },
  });
  await projectActiveMembership(tx, args.userId);
}

/** Set a membership's custom role (same-org validated by the caller) and re-project. */
export async function setMembershipCustomRoleTx(
  tx: Tx,
  args: { userId: string; organizationId: string; customRoleId: string },
): Promise<void> {
  await tx.membership.updateMany({
    where: { userId: args.userId, organizationId: args.organizationId },
    data: { customRoleId: args.customRoleId },
  });
  await projectActiveMembership(tx, args.userId);
}

// --- Convenience wrappers (own transaction) ---------------------------------

export function transferOwnership(args: { organizationId: string; toUserId: string; demoteRole?: Role }) {
  return db.$transaction((tx) => transferOwnershipTx(tx, args));
}

// --- Query helpers -----------------------------------------------------------

/** All of a user's memberships with org context — the profile's memberships tab. */
export function membershipsForUser(userId: string) {
  return db.membership.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      organization: { select: { id: true, name: true, slug: true, status: true, ownerId: true } },
      customRole: { select: { id: true, name: true } },
      primaryLocation: { select: { id: true, name: true, icao: true } },
    },
  });
}

/** Live membership counts for an org (never confused with subscription limits). */
export async function orgMembershipSummary(organizationId: string) {
  const [active, deactivated, byRole] = await Promise.all([
    db.membership.count({ where: { organizationId, status: "ACTIVE" } }),
    db.membership.count({ where: { organizationId, status: "DEACTIVATED" } }),
    db.membership.groupBy({ by: ["role"], where: { organizationId, status: "ACTIVE" }, _count: true }),
  ]);
  const roleCount = (role: Role) => byRole.find((r) => r.role === role)?._count ?? 0;
  const students = roleCount("STUDENT");
  const instructors = roleCount("INSTRUCTOR");
  return {
    active,
    deactivated,
    students,
    instructors,
    // Staff = active members who are neither students nor instructors.
    staff: active - students - instructors,
    owners: roleCount("ACCOUNT_OWNER"),
    admins: roleCount("SCHOOL_ADMIN") + roleCount("ACCOUNT_OWNER"),
  };
}
