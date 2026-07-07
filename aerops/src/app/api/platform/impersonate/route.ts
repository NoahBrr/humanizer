import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform, encodeImpersonation, decodeImpersonation, impersonationTtlMs, IMPERSONATION_COOKIE } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const IMPERSONATION_ROLES = ["FOUNDER", "PLATFORM_ADMIN", "CUSTOMER_SUCCESS", "SUPPORT_ENGINEER"] as const;

const startSchema = z.object({
  userId: z.string(),
  readOnly: z.boolean().default(true),
});

/** Start an impersonation session. Always audited; org is notified at session end. */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform([...IMPERSONATION_ROLES]);
  if (error) return error;

  const body = startSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const target = await db.user.findUnique({ where: { id: body.data.userId }, include: { organization: true } });
  if (!target || !target.isActive || target.deletedAt) return NextResponse.json({ error: "Target user not found" }, { status: 404 });
  if (!target.organization) return NextResponse.json({ error: "This user does not belong to an organization yet" }, { status: 400 });
  if (target.organization.status === "DELETED") return NextResponse.json({ error: "Organization is deleted" }, { status: 400 });

  const value = encodeImpersonation({
    platformUserId: session.userId,
    targetUserId: target.id,
    readOnly: body.data.readOnly,
    exp: Date.now() + impersonationTtlMs(),
  });

  await recordAudit({
    organizationId: target.organizationId,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName} (AeroOps)`,
    action: "platform.impersonation_start",
    entityType: "User",
    entityId: target.id,
    newValue: { targetEmail: target.email, readOnly: body.data.readOnly },
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

/** End the impersonation session; audits and notifies the organization. */
export async function DELETE() {
  const { session, error } = await authorizePlatform();
  if (error) return error;

  const cookieStore = await cookies();
  const raw = cookieStore.get(IMPERSONATION_COOKIE)?.value;
  const payload = raw ? decodeImpersonation(raw) : null;

  if (payload) {
    const target = await db.user.findUnique({ where: { id: payload.targetUserId } });
    if (target) {
      // While impersonating, session.userId is the TARGET user — the real
      // actor is the platform user recorded in the signed cookie.
      await recordAudit({
        organizationId: target.organizationId,
        actorPlatformUserId: payload.platformUserId,
        actorLabel: `${session.impersonation?.platformLabel ?? `${session.firstName} ${session.lastName}`} (AeroOps)`,
        action: "platform.impersonation_end",
        entityType: "User",
        entityId: target.id,
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
