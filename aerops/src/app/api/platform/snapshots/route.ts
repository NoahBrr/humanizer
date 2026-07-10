import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform, platformOrgScopeError } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { captureSnapshot } from "@/lib/org-snapshot";

const schema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
});

/** Capture a point-in-time snapshot of an organization's data. */
export async function POST(req: Request) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN"], { mutating: true });
  if (error) return error;

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const org = await db.organization.findUnique({ where: { id: body.data.orgId }, select: { id: true, name: true, deletedAt: true } });
  if (!org || org.deletedAt) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const scopeError = platformOrgScopeError(session, org.id);
  if (scopeError) return scopeError;

  try {
    const snap = await captureSnapshot(org.id, body.data.name, session.email, body.data.description);
    await recordAudit({
      organizationId: org.id,
      actorPlatformUserId: session.userId,
      actorLabel: `${session.firstName} ${session.lastName}`,
      action: "platform.snapshot.create",
      entityType: "OrgSnapshot",
      entityId: snap.id,
      newValue: { name: body.data.name, sizeBytes: snap.sizeBytes },
    });
    return NextResponse.json({ ok: true, snapshot: snap });
  } catch (e) {
    console.error("snapshot capture failed", e);
    return NextResponse.json({ error: "Snapshot capture failed" }, { status: 500 });
  }
}
