import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { emitWebhook } from "@/lib/webhooks";

const patchSchema = z.object({
  status: z.enum(["AVAILABLE", "IN_MAINTENANCE", "GROUNDED", "RESERVED", "RETIRED"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("aircraft.ground", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const aircraft = await db.aircraft.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!aircraft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const updated = await db.aircraft.update({ where: { id }, data: { status: body.data.status } });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "aircraft.status_change",
    entityType: "Aircraft",
    entityId: id,
    oldValue: { status: aircraft.status },
    newValue: { status: body.data.status },
  });

  if (body.data.status === "GROUNDED") {
    await emitWebhook(session.organizationId, "aircraft.grounded", { aircraftId: id, tailNumber: aircraft.tailNumber });
    await db.notification.create({
      data: {
        organizationId: session.organizationId,
        kind: "AIRCRAFT_GROUNDED",
        title: `${aircraft.tailNumber} grounded`,
        body: `Grounded by ${session.firstName} ${session.lastName}. Upcoming bookings need review.`,
      },
    });
  }

  return NextResponse.json({ aircraft: updated });
}
