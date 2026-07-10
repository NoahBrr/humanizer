import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { restoreSnapshot } from "@/lib/org-snapshot";

/** Restore an organization to a snapshot — replaces its current data. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN"], { mutating: true });
  if (error) return error;
  const { id } = await params;

  try {
    const result = await restoreSnapshot(id);
    await recordAudit({
      organizationId: result.organizationId,
      actorPlatformUserId: session.userId,
      actorLabel: `${session.firstName} ${session.lastName}`,
      action: "platform.snapshot.restore",
      entityType: "OrgSnapshot",
      entityId: id,
      newValue: { restoredFrom: result.restoredFrom },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("snapshot restore failed", e);
    return NextResponse.json({ error: "Snapshot restore failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN"], { mutating: true });
  if (error) return error;
  const { id } = await params;

  const snap = await db.orgSnapshot.delete({ where: { id }, select: { name: true, organizationId: true } }).catch(() => null);
  if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await recordAudit({
    organizationId: snap.organizationId,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "platform.snapshot.delete",
    entityType: "OrgSnapshot",
    entityId: id,
    oldValue: { name: snap.name },
  });
  return NextResponse.json({ ok: true });
}
