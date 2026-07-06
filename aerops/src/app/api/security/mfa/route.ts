import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { generateSecret, otpauthUrl, verifyTotp } from "@/lib/totp";
import { recordAudit } from "@/lib/audit";

function tableFor(session: { kind: string }) {
  return session.kind === "platform" ? db.platformUser : db.user;
}

/** Begin enrollment: issue a pending secret (not yet active). */
export async function POST() {
  const session = await getSession();
  if (!session || session.impersonation) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const secret = generateSecret();
  // Stored immediately but only honored once verified (mfaEnabled=true).
  // @ts-expect-error — user/platformUser delegates share this shape
  await tableFor(session).update({ where: { id: session.userId }, data: { mfaSecret: secret, mfaEnabled: false } });
  return NextResponse.json({ secret, otpauth: otpauthUrl(secret, session.email) });
}

const verifySchema = z.object({ code: z.string().min(6).max(8) });

/** Confirm enrollment with a live code from the authenticator. */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.impersonation) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = verifySchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app." }, { status: 400 });

  // @ts-expect-error — shared delegate shape
  const account = await tableFor(session).findUnique({ where: { id: session.userId }, select: { mfaSecret: true } });
  if (!account?.mfaSecret) return NextResponse.json({ error: "Start enrollment first." }, { status: 400 });
  if (!verifyTotp(account.mfaSecret, body.data.code)) {
    return NextResponse.json({ error: "That code didn't match — check your authenticator and try again." }, { status: 400 });
  }

  // @ts-expect-error — shared delegate shape
  await tableFor(session).update({ where: { id: session.userId }, data: { mfaEnabled: true } });
  await recordAudit({
    organizationId: session.organizationId || null,
    actorUserId: session.kind === "org" ? session.userId : null,
    actorPlatformUserId: session.kind === "platform" ? session.userId : null,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "security.mfa_enabled",
    entityType: session.kind === "platform" ? "PlatformUser" : "User",
    entityId: session.userId,
  });
  return NextResponse.json({ ok: true });
}

/** Disable MFA (requires a valid current code). */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session || session.impersonation) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = verifySchema.safeParse(await req.json());
  // @ts-expect-error — shared delegate shape
  const account = await tableFor(session).findUnique({ where: { id: session.userId }, select: { mfaSecret: true, mfaEnabled: true } });
  if (!account?.mfaEnabled) return NextResponse.json({ error: "MFA is not enabled." }, { status: 400 });
  if (!body.success || !account.mfaSecret || !verifyTotp(account.mfaSecret, body.data.code)) {
    return NextResponse.json({ error: "A valid current code is required to disable MFA." }, { status: 400 });
  }

  // @ts-expect-error — shared delegate shape
  await tableFor(session).update({ where: { id: session.userId }, data: { mfaEnabled: false, mfaSecret: null } });
  await recordAudit({
    organizationId: session.organizationId || null,
    actorUserId: session.kind === "org" ? session.userId : null,
    actorPlatformUserId: session.kind === "platform" ? session.userId : null,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "security.mfa_disabled",
    entityType: session.kind === "platform" ? "PlatformUser" : "User",
    entityId: session.userId,
  });
  return NextResponse.json({ ok: true });
}
