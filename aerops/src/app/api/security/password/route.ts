import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { validatePassword } from "@/lib/password";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string() });

export async function POST(req: Request) {
  const limited = rateLimit(`pw-change:${clientIp(req)}`, 5, 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  const session = await getSession();
  if (!session || session.impersonation) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const policy = validatePassword(body.data.newPassword);
  if (!policy.ok) return NextResponse.json({ error: policy.error }, { status: 400 });

  const table = session.kind === "platform" ? db.platformUser : db.user;
  // @ts-expect-error — user/platformUser delegates share this shape
  const account = await table.findUnique({ where: { id: session.userId }, select: { passwordHash: true } });
  if (!account || !(await bcrypt.compare(body.data.currentPassword, account.passwordHash))) {
    return NextResponse.json({ error: "Your current password didn't match." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(body.data.newPassword, 10);
  // Rotating the password also invalidates every other signed-in device.
  // @ts-expect-error — shared delegate shape
  await table.update({ where: { id: session.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  await recordAudit({
    organizationId: session.organizationId || null,
    actorUserId: session.kind === "org" ? session.userId : null,
    actorPlatformUserId: session.kind === "platform" ? session.userId : null,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "security.password_changed",
    entityId: session.userId,
  });
  return NextResponse.json({ ok: true });
}
