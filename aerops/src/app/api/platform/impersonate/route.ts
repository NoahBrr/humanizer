import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { encodeImpersonation, impersonationTtlMs, readActiveImpersonation, IMPERSONATION_COOKIE } from "@/lib/impersonation";
import { recordAudit } from "@/lib/audit";
import { platformRolesWith } from "@/lib/platform-permissions";

const startSchema = z.object({
  userId: z.string(),
  readOnly: z.boolean().default(true),
  // A recorded reason is required for every support session (ADR-023).
  reason: z.string().trim().min(3, "A reason is required").max(500),
});

/**
 * Start an impersonation session. A durable ImpersonationSession row anchors the
 * support session; the signed cookie carries its id so every subsequent audit
 * links back to it. Nested impersonation is impossible — authorizePlatform
 * `{ mutating: true }` refuses to start while already impersonating. Always
 * audited; the org is notified at session end.
 */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform(platformRolesWith("platform.impersonate"), { mutating: true });
  if (error) return error;

  const body = startSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const target = await db.user.findUnique({ where: { id: body.data.userId }, include: { organization: true } });
  if (!target || !target.isActive || target.deletedAt) return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  if (!target.organization || !target.organizationId) return NextResponse.json({ error: "This user does not belong to an organization yet" }, { status: 400 });
  if (target.organization.status === "DELETED") return NextResponse.json({ error: "Organization is deleted" }, { status: 400 });

  const expiresAt = new Date(Date.now() + impersonationTtlMs());
  const platformLabel = `${session.firstName} ${session.lastName}`;

  const impSession = await db.impersonationSession.create({
    data: {
      platformUserId: session.userId,
      targetUserId: target.id,
      organizationId: target.organizationId,
      reason: body.data.reason,
      readOnly: body.data.readOnly,
      expiresAt,
    },
  });

  const value = encodeImpersonation({
    platformUserId: session.userId,
    platformLabel,
    targetUserId: target.id,
    organizationId: target.organizationId,
    sessionId: impSession.id,
    readOnly: body.data.readOnly,
    exp: expiresAt.getTime(),
  });

  await recordAudit({
    organizationId: target.organizationId,
    actorPlatformUserId: session.userId,
    impersonatedUserId: target.id,
    impersonationSessionId: impSession.id,
    actorLabel: `${platformLabel} (AeroOps)`,
    action: "platform.impersonation_start",
    entityType: "ImpersonationSession",
    entityId: impSession.id,
    newValue: { targetEmail: target.email, targetUserId: target.id, readOnly: body.data.readOnly, reason: body.data.reason },
  });

  const res = NextResponse.json({ ok: true, redirect: "/dashboard" });
  res.cookies.set(IMPERSONATION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: impersonationTtlMs() / 1000,
    path: "/",
  });
  return res;
}

/** End the impersonation session; closes the session row, audits, and notifies
 *  the organization. Passes without `{ mutating }` so it works while impersonating. */
export async function DELETE() {
  const { error } = await authorizePlatform();
  if (error) return error;

  const payload = await readActiveImpersonation();

  if (payload) {
    const target = await db.user.findUnique({ where: { id: payload.targetUserId } });
    // Close the durable session row (idempotent) — expiry would also end it.
    await db.impersonationSession.updateMany({ where: { id: payload.sessionId, endedAt: null }, data: { endedAt: new Date() } });
    if (target) {
      // While impersonating, session.userId is the TARGET user — the real actor
      // is the platform user recorded in the signed cookie.
      await recordAudit({
        organizationId: payload.organizationId ?? target.organizationId,
        actorPlatformUserId: payload.platformUserId,
        impersonatedUserId: target.id,
        impersonationSessionId: payload.sessionId,
        actorLabel: `${payload.platformLabel} (AeroOps)`,
        action: "platform.impersonation_end",
        entityType: "ImpersonationSession",
        entityId: payload.sessionId,
      });
      if (target.organizationId) await db.notification.create({
        data: {
          organizationId: target.organizationId,
          kind: "GENERAL",
          title: "AeroOps support session ended",
          body: `An AeroOps support engineer accessed your workspace as ${target.firstName} ${target.lastName} (${payload.readOnly ? "read-only" : "full access"}). Details are in the audit log.`,
        },
      });
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.delete(IMPERSONATION_COOKIE);
  return res;
}
