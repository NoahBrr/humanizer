import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { PANEL_KEYS } from "@/lib/mission-control-scenes";

/**
 * Saved Mission Control scenes (Section 16B). Anyone in the org can list and
 * display scenes; creating and deleting shared scenes is a layout-management
 * permission (settings.manage), and both are audited.
 */
export async function GET() {
  const { session, error } = await authorize("notifications.view");
  if (error) return error;
  const scenes = await db.missionControlScene.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ scenes });
}

const postSchema = z.object({
  name: z.string().min(2).max(40),
  panels: z.array(z.enum(PANEL_KEYS)).min(1).max(12),
});

export async function POST(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = postSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const existing = await db.missionControlScene.findFirst({
    where: { organizationId: session.organizationId, name: body.data.name },
  });
  if (existing) return NextResponse.json({ error: "A scene with that name already exists." }, { status: 409 });

  const scene = await db.missionControlScene.create({
    data: {
      organizationId: session.organizationId,
      name: body.data.name,
      panels: [...new Set(body.data.panels)],
      createdBy: `${session.firstName} ${session.lastName}`,
    },
  });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "mission_control.scene_created",
    entityType: "MissionControlScene",
    entityId: scene.id,
    newValue: { name: scene.name, panels: scene.panels },
  });
  return NextResponse.json({ scene }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const scene = await db.missionControlScene.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.missionControlScene.delete({ where: { id } });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "mission_control.scene_deleted",
    entityType: "MissionControlScene",
    entityId: id,
    oldValue: { name: scene.name },
  });
  return NextResponse.json({ ok: true });
}
