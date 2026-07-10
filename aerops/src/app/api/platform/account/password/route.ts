import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/password";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string() });

/**
 * A platform user rotates their OWN password (D3-A). Self-service — gated by a
 * platform session (not `{ mutating: true }`, so a user with mustChangePassword
 * can still perform exactly this action). Clears `mustChangePassword` and bumps
 * `sessionVersion` (logs out other sessions). Verifies the current password.
 */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform();
  if (error) return error;

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const policy = validatePassword(body.data.newPassword);
  if (!policy.ok) return NextResponse.json({ error: policy.error }, { status: 400 });

  const pu = await db.platformUser.findUnique({ where: { id: session.userId }, select: { passwordHash: true } });
  if (!pu || !(await bcrypt.compare(body.data.currentPassword, pu.passwordHash))) {
    return NextResponse.json({ error: "Your current password is incorrect." }, { status: 403 });
  }
  await db.platformUser.update({
    where: { id: session.userId },
    data: { passwordHash: await bcrypt.hash(body.data.newPassword, 10), mustChangePassword: false, sessionVersion: { increment: 1 } },
  });
  await recordAudit({
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "platform_user.password_change",
    entityType: "PlatformUser",
    entityId: session.userId,
  });
  return NextResponse.json({ ok: true });
}
