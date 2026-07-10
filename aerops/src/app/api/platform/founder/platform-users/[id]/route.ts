import { NextResponse } from "next/server";
import { z } from "zod";
import type { PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { authorizeFounder } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  ASSIGNABLE_PLATFORM_ROLES,
  canAssignPlatformRoleDirectly,
  canDeactivatePlatformUser,
  canScopePlatformUser,
  requiresFounderChangeReason,
  validAccessWindow,
} from "@/lib/platform-user-admin";

const PLATFORM_ROLE_VALUES = ASSIGNABLE_PLATFORM_ROLES as [PlatformRole, ...PlatformRole[]];
const reason = z.string().max(500).optional();

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_role"), role: z.enum(PLATFORM_ROLE_VALUES), reason }),
  z.object({ action: z.literal("activate"), reason }),
  z.object({ action: z.literal("deactivate"), reason }),
  z.object({ action: z.literal("force_logout"), reason }),
  z.object({
    action: z.literal("set_scope"),
    readOnly: z.boolean().optional(),
    restrictedOrgIds: z.array(z.string()).max(500).optional(),
    accessStartsAt: z.string().datetime().nullish(),
    accessExpiresAt: z.string().datetime().nullish(),
    reason,
  }),
]);

/**
 * Founder actions on a single Platform User (D3-A). Founder-only (authorizeFounder),
 * audited, and safeguarded: FOUNDER_SUPER_ADMIN is never assignable here; the last
 * active founder cannot be deactivated; any change to a founder requires a recorded
 * reason; you cannot deactivate yourself; secrets are never touched. Founder
 * identity (`isFounder`) is immutable — only the bootstrap sets it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizeFounder({ mutating: true });
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;

  const { id } = await params;
  const target = await db.platformUser.findUnique({
    where: { id },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isFounder: true, isActive: true },
  });
  if (!target) return NextResponse.json({ error: "Platform User not found" }, { status: 404 });

  // Founder-to-founder (and any change to a founder) requires a recorded reason.
  const reasonCheck = requiresFounderChangeReason(target.isFounder, body.reason);
  if (!reasonCheck.ok) return NextResponse.json({ error: reasonCheck.reason }, { status: 400 });

  const actorLabel = `${session.firstName} ${session.lastName} (Founder)`;
  const targetName = `${target.firstName} ${target.lastName}`;
  const audit = (action: string, oldValue: unknown, newValue: unknown) =>
    recordAudit({ actorPlatformUserId: session.userId, actorLabel, action, entityType: "PlatformUser", entityId: target.id, oldValue, newValue });

  switch (body.action) {
    case "set_role": {
      const check = canAssignPlatformRoleDirectly(body.role);
      if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 });
      await db.platformUser.update({ where: { id: target.id }, data: { role: body.role } });
      await audit("founder.platform_user_role_change", { role: target.role }, { role: body.role, reason: body.reason });
      return NextResponse.json({ ok: true });
    }

    case "deactivate": {
      if (target.id === session.userId) return NextResponse.json({ error: "You cannot deactivate your own account." }, { status: 409 });
      // Atomic last-founder guard (TOCTOU-safe): a shared transaction advisory
      // lock serializes concurrent founder deactivations, so the "another founder
      // remains active" check and the deactivation cannot interleave into a
      // zero-founder state. Bumping sessionVersion revokes live sessions at once.
      const outcome = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aerops.founder.mutation'))`;
        const others = await tx.platformUser.count({ where: { isFounder: true, isActive: true, id: { not: target.id } } });
        const guard = canDeactivatePlatformUser({ targetIsFounder: target.isFounder, otherActiveFoundersExist: others > 0 });
        if (!guard.ok) return { blocked: guard.reason as string };
        await tx.platformUser.update({ where: { id: target.id }, data: { isActive: false, sessionVersion: { increment: 1 } } });
        return { blocked: null };
      });
      if (outcome.blocked) return NextResponse.json({ error: outcome.blocked }, { status: 409 });
      await audit("founder.platform_user_deactivate", { isActive: true }, { isActive: false, reason: body.reason });
      return NextResponse.json({ ok: true });
    }

    case "activate": {
      await db.platformUser.update({ where: { id: target.id }, data: { isActive: true } });
      await audit("founder.platform_user_activate", { isActive: false }, { isActive: true, reason: body.reason });
      return NextResponse.json({ ok: true });
    }

    case "force_logout": {
      await db.platformUser.update({ where: { id: target.id }, data: { sessionVersion: { increment: 1 } } });
      await audit("founder.platform_user_force_logout", null, { user: targetName, reason: body.reason });
      return NextResponse.json({ ok: true });
    }

    case "set_scope": {
      // Scopes (read-only, time-boxed, org-restricted) never apply to a founder —
      // that could irrecoverably lock out the last founder or oneself.
      const scopeCheck = canScopePlatformUser(target.isFounder);
      if (!scopeCheck.ok) return NextResponse.json({ error: scopeCheck.reason }, { status: 409 });
      const startsAt = body.accessStartsAt === undefined ? undefined : body.accessStartsAt ? new Date(body.accessStartsAt) : null;
      const expiresAt = body.accessExpiresAt === undefined ? undefined : body.accessExpiresAt ? new Date(body.accessExpiresAt) : null;
      const win = validAccessWindow(startsAt ?? null, expiresAt ?? null);
      if (!win.ok) return NextResponse.json({ error: win.reason }, { status: 400 });
      await db.platformUser.update({
        where: { id: target.id },
        data: {
          ...(body.readOnly !== undefined ? { readOnly: body.readOnly } : {}),
          ...(body.restrictedOrgIds !== undefined ? { restrictedOrgIds: body.restrictedOrgIds } : {}),
          ...(startsAt !== undefined ? { accessStartsAt: startsAt } : {}),
          ...(expiresAt !== undefined ? { accessExpiresAt: expiresAt } : {}),
          // Re-resolve the new scope immediately on their next request.
          sessionVersion: { increment: 1 },
        },
      });
      await audit("founder.platform_user_scope_change", null, {
        readOnly: body.readOnly, restrictedOrgCount: body.restrictedOrgIds?.length,
        accessStartsAt: startsAt, accessExpiresAt: expiresAt, reason: body.reason,
      });
      return NextResponse.json({ ok: true });
    }
  }
}
