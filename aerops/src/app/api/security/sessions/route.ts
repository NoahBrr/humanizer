import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

/**
 * "Log out all devices": bump sessionVersion so every outstanding JWT for
 * this account fails validation on its next request (including this one —
 * the client redirects to sign-in).
 */
export async function DELETE() {
  const session = await getSession();
  if (!session || session.impersonation) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.kind === "platform") {
    await db.platformUser.update({ where: { id: session.userId }, data: { sessionVersion: { increment: 1 } } });
  } else {
    await db.user.update({ where: { id: session.userId }, data: { sessionVersion: { increment: 1 } } });
  }
  await recordAudit({
    organizationId: session.organizationId || null,
    actorUserId: session.kind === "org" ? session.userId : null,
    actorPlatformUserId: session.kind === "platform" ? session.userId : null,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "security.logout_all_devices",
    entityId: session.userId,
  });
  return NextResponse.json({ ok: true });
}
