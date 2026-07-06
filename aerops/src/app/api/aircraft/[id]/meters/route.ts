import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const schema = z.object({
  hobbs: z.number().positive().optional(),
  tach: z.number().positive().optional(),
  reason: z.string().min(5, "A reason is required for manual meter adjustments."),
});

/**
 * Manual hobbs/tach adjustment — admin-only (settings.manage), reason
 * required, old and new values recorded in the immutable audit trail.
 * Normal meter movement happens automatically at flight closeout.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const aircraft = await db.aircraft.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!aircraft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  if (body.data.hobbs === undefined && body.data.tach === undefined) {
    return NextResponse.json({ error: "Provide a new hobbs or tach value." }, { status: 400 });
  }

  const updated = await db.aircraft.update({
    where: { id },
    data: {
      ...(body.data.hobbs !== undefined ? { currentHobbs: body.data.hobbs } : {}),
      ...(body.data.tach !== undefined ? { currentTach: body.data.tach } : {}),
    },
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "aircraft.meter_adjustment",
    entityType: "Aircraft",
    entityId: id,
    oldValue: { hobbs: Number(aircraft.currentHobbs), tach: Number(aircraft.currentTach) },
    newValue: { hobbs: Number(updated.currentHobbs), tach: Number(updated.currentTach), reason: body.data.reason },
  });

  return NextResponse.json({ aircraft: updated });
}
