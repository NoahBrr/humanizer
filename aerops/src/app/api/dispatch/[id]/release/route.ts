import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { airworthinessOf } from "@/lib/airworthiness";

const releaseSchema = z.object({
  fuelQty: z.string().min(1),
  oilQty: z.string().min(1),
  weatherAcknowledged: z.literal(true),
  documentsVerified: z.literal(true),
  instructorApproved: z.boolean(),
  studentApproved: z.boolean(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("dispatch.release", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const dispatch = await db.dispatch.findFirst({
    where: { id, aircraft: { organizationId: session.organizationId } },
    include: { aircraft: { include: { components: true } } },
  });
  if (!dispatch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (dispatch.status !== "PENDING") return NextResponse.json({ error: "Dispatch is not pending release" }, { status: 400 });
  const airworthiness = airworthinessOf(dispatch.aircraft, dispatch.aircraft.components);
  if (!airworthiness.canDispatch) {
    return NextResponse.json({ error: `${dispatch.aircraft.tailNumber} is not airworthy: ${airworthiness.detail}` }, { status: 409 });
  }

  const body = releaseSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "All release checks must be completed" }, { status: 400 });

  const updated = await db.dispatch.update({
    where: { id },
    data: {
      ...body.data,
      status: "RELEASED",
      releasedAt: new Date(),
      releasedBy: `${session.firstName} ${session.lastName}`,
      hobbsOut: dispatch.aircraft.currentHobbs,
      tachOut: dispatch.aircraft.currentTach,
      scheduleEvent: { update: { status: "DISPATCHED" } },
    },
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "dispatch.release",
    entityType: "Dispatch",
    entityId: id,
    newValue: { tailNumber: dispatch.aircraft.tailNumber, fuelQty: body.data.fuelQty, oilQty: body.data.oilQty },
  });

  return NextResponse.json({ dispatch: updated });
}
