import { NextResponse } from "next/server";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { authorizePlatform, platformOrgScopeError } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { platformRolesWith, type PlatformPermission } from "@/lib/platform-permissions";
import { ASSIGNABLE_SYSTEM_ROLES } from "@/lib/permissions";
import {
  resolvePermissions,
  isEffectiveAdmin,
  canDeactivateUser,
  canReactivateUser,
  canTransferOwnerTo,
  canChangeRole,
} from "@/lib/platform-users";
import {
  transferOwnership,
  setMembershipRoleTx,
  setMembershipCustomRoleTx,
  setMembershipStatusTx,
} from "@/lib/memberships";

// Roles assignable via the ordinary role-change flow — ACCOUNT_OWNER (ownership
// workflow only) and the retired SUPER_ADMIN are deliberately excluded.
const ROLE_VALUES = ASSIGNABLE_SYSTEM_ROLES as [Role, ...Role[]];
const reason = z.string().max(500).optional();

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deactivate"), reason }),
  z.object({ action: z.literal("reactivate"), reason }),
  z.object({ action: z.literal("force_logout"), reason }),
  z.object({ action: z.literal("deactivate_membership"), reason }),
  z.object({ action: z.literal("reactivate_membership"), reason }),
  z.object({ action: z.literal("set_role"), role: z.enum(ROLE_VALUES), reason }),
  z.object({ action: z.literal("set_custom_role"), customRoleId: z.string().min(1), reason }),
  z.object({ action: z.literal("transfer_owner"), reason }),
]);

const PERM_BY_ACTION: Record<z.infer<typeof bodySchema>["action"], PlatformPermission> = {
  deactivate: "platform.users.manage",
  reactivate: "platform.users.manage",
  force_logout: "platform.users.manage",
  deactivate_membership: "platform.users.manage",
  reactivate_membership: "platform.users.manage",
  set_role: "platform.roles.manage",
  set_custom_role: "platform.roles.manage",
  transfer_owner: "platform.users.transfer_owner",
};

/**
 * Platform-staff actions on a single customer user. The [id] is always a
 * customer `User` (never a PlatformUser — a mismatched id 404s). Every branch
 * is capability-gated via the platform permission matrix, audited with the
 * staff actor, and — where it changes customer access — surfaced to the org as
 * a notification (the impersonation-disclosure precedent). Mutations are refused
 * while impersonating (authorizePlatform `{ mutating: true }`).
 *
 * Ownership and roles route through the membership service (lib/memberships.ts):
 * ownership transfer updates `Organization.ownerId` and the ACCOUNT_OWNER
 * membership atomically; ACCOUNT_OWNER is never assignable as an ordinary role;
 * the current owner cannot be deactivated, demoted, or membership-removed until
 * ownership is transferred (last-owner safeguard, ADR-023).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Reject non-staff (and any impersonating session) before touching the body.
  const staffGate = await authorizePlatform(undefined, { mutating: true });
  if (staffGate.error) return staffGate.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  // Capability check for the specific action.
  const { session, error } = await authorizePlatform(platformRolesWith(PERM_BY_ACTION[body.action]), { mutating: true });
  if (error) return error;
  const actorLabel = `${session.firstName} ${session.lastName} (AeroOps)`;

  const { id } = await params;
  const target = await db.user.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true, status: true, ownerId: true } },
      customRole: { select: { permissions: true } },
    },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const orgId = target.organizationId;
  // Org-restricted staff may manage users only within their scoped orgs (D3-A).
  if (orgId) {
    const scopeError = platformOrgScopeError(session, orgId);
    if (scopeError) return scopeError;
  }
  const needsOrg =
    body.action === "set_role" ||
    body.action === "set_custom_role" ||
    body.action === "transfer_owner" ||
    body.action === "deactivate_membership" ||
    body.action === "reactivate_membership";
  if (needsOrg && !orgId) {
    return NextResponse.json({ error: "This user does not belong to an organization yet." }, { status: 400 });
  }
  const isOwner = !!target.organization && target.organization.ownerId === target.id;

  const notifyOrg = async (title: string, notifyBody: string) => {
    if (orgId) await db.notification.create({ data: { organizationId: orgId, kind: "GENERAL", title, body: notifyBody } });
  };
  const targetName = `${target.firstName} ${target.lastName}`;

  switch (body.action) {
    case "deactivate": {
      const targetIsAdmin = isEffectiveAdmin(resolvePermissions(target.role, target.customRole?.permissions));
      let isLastActiveAdmin = false;
      if (targetIsAdmin && orgId) {
        // Correct across multi-org: judge peers by their MEMBERSHIP role in THIS
        // org (not their projected User.role, which reflects their active org).
        const peers = await db.membership.findMany({
          where: { organizationId: orgId, status: "ACTIVE", userId: { not: target.id }, user: { isActive: true, deletedAt: null } },
          select: { role: true, customRole: { select: { permissions: true } } },
        });
        isLastActiveAdmin = !peers.some((m) => isEffectiveAdmin(resolvePermissions(m.role, m.customRole?.permissions)));
      }
      // Account deactivation is refused if the user owns ANY live org (not just
      // their projected active one) — deactivating them would strand it ownerless.
      const ownsAnyActiveOrg = (await db.organization.count({ where: { ownerId: target.id, deletedAt: null } })) > 0;
      const check = canDeactivateUser({ isOwner: ownsAnyActiveOrg, isLastActiveAdmin, isDeleted: !!target.deletedAt });
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });

      await db.user.update({ where: { id: target.id }, data: { isActive: false } });
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.user_deactivate", entityType: "User", entityId: target.id,
        oldValue: { isActive: true }, newValue: { isActive: false, reason: body.reason },
      });
      await notifyOrg("A member's access was suspended by AeroOps", `AeroOps support deactivated ${targetName}'s account. Contact support if this was unexpected — details are in your audit log.`);
      return NextResponse.json({ ok: true });
    }

    case "reactivate": {
      const check = canReactivateUser({ isDeleted: !!target.deletedAt });
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });

      await db.user.update({ where: { id: target.id }, data: { isActive: true } });
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.user_reactivate", entityType: "User", entityId: target.id,
        oldValue: { isActive: false }, newValue: { isActive: true, reason: body.reason },
      });
      await notifyOrg("A member's access was restored by AeroOps", `AeroOps support reactivated ${targetName}'s account.`);
      return NextResponse.json({ ok: true });
    }

    case "force_logout": {
      // Revoke every live JWT for this user (same idiom as "log out all devices").
      await db.user.update({ where: { id: target.id }, data: { sessionVersion: { increment: 1 } } });
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.user_force_logout", entityType: "User", entityId: target.id,
        newValue: { reason: body.reason },
      });
      return NextResponse.json({ ok: true });
    }

    case "deactivate_membership": {
      // Removing a member from one org. The Account Owner's membership is
      // protected until ownership is transferred (last-owner safeguard).
      if (isOwner) return NextResponse.json({ error: "Transfer the Account Owner role to another member before removing this membership." }, { status: 409 });
      await db.$transaction((tx) => setMembershipStatusTx(tx, { userId: target.id, organizationId: orgId!, status: "DEACTIVATED" }));
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.membership_deactivate", entityType: "Membership", entityId: target.id,
        newValue: { organizationId: orgId, reason: body.reason },
      });
      await notifyOrg("A member's organization access was removed by AeroOps", `AeroOps support removed ${targetName} from ${target.organization?.name ?? "the organization"}.`);
      return NextResponse.json({ ok: true });
    }

    case "reactivate_membership": {
      await db.$transaction((tx) => setMembershipStatusTx(tx, { userId: target.id, organizationId: orgId!, status: "ACTIVE" }));
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.membership_reactivate", entityType: "Membership", entityId: target.id,
        newValue: { organizationId: orgId, reason: body.reason },
      });
      await notifyOrg("A member's organization access was restored by AeroOps", `AeroOps support restored ${targetName}'s access to ${target.organization?.name ?? "the organization"}.`);
      return NextResponse.json({ ok: true });
    }

    case "set_role": {
      const guard = canChangeRole({ isOwner, targetRole: body.role });
      if (!guard.ok) return NextResponse.json({ error: guard.reason }, { status: 409 });

      const old = { role: target.role, customRoleId: target.customRoleId };
      await db.$transaction((tx) => setMembershipRoleTx(tx, { userId: target.id, organizationId: orgId!, role: body.role }));
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.user_role_change", entityType: "User", entityId: target.id,
        oldValue: old, newValue: { role: body.role, customRoleId: null, reason: body.reason },
      });
      await notifyOrg("A member's role was changed by AeroOps", `AeroOps support set ${targetName}'s role to ${body.role.replace("_", " ").toLowerCase()}.`);
      return NextResponse.json({ ok: true });
    }

    case "set_custom_role": {
      // The Account Owner's role is locked to the ownership workflow.
      if (isOwner) return NextResponse.json({ error: "This user is the Account Owner — transfer ownership before changing their role." }, { status: 409 });
      // Cross-tenant guard: the custom role must belong to THIS user's org, or
      // it would grant another tenant's permission bundle.
      const role = await db.orgRole.findFirst({ where: { id: body.customRoleId, organizationId: orgId! }, select: { id: true, name: true } });
      if (!role) return NextResponse.json({ error: "That role does not exist in this organization." }, { status: 400 });

      const old = { role: target.role, customRoleId: target.customRoleId };
      await db.$transaction((tx) => setMembershipCustomRoleTx(tx, { userId: target.id, organizationId: orgId!, customRoleId: role.id }));
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.user_role_change", entityType: "User", entityId: target.id,
        oldValue: old, newValue: { customRoleId: role.id, customRoleName: role.name, reason: body.reason },
      });
      await notifyOrg("A member's role was changed by AeroOps", `AeroOps support set ${targetName}'s role to ${role.name}.`);
      return NextResponse.json({ ok: true });
    }

    case "transfer_owner": {
      const check = canTransferOwnerTo({ exists: true, isActive: target.isActive, isDeleted: !!target.deletedAt, sameOrg: true });
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });
      if (isOwner) return NextResponse.json({ error: "This user is already the Account Owner." }, { status: 409 });

      const previousOwnerId = target.organization?.ownerId ?? null;
      // Atomic: former owner demoted to Organization Administrator, new owner
      // promoted to ACCOUNT_OWNER, Organization.ownerId moved — one transaction.
      await transferOwnership({ organizationId: orgId!, toUserId: target.id });
      await recordAudit({
        organizationId: orgId, actorPlatformUserId: session.userId, actorLabel,
        action: "platform.user_transfer_owner", entityType: "Organization", entityId: orgId!,
        oldValue: { ownerId: previousOwnerId }, newValue: { ownerId: target.id, reason: body.reason },
      });
      await notifyOrg("Account Owner changed by AeroOps", `AeroOps support transferred the Account Owner role to ${targetName}.`);
      return NextResponse.json({ ok: true });
    }
  }
}
