import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";

const releaseSchema = z.object({
  fuelQty: z.string().min(1),
  oilQty: z.string().min(1),
  weatherAcknowledged: z.literal(true),
  documentsVerified: z.literal(true),
  instructorApproved: z.boolean(),
  studentApproved: z.boolean(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "DISPATCHER", "INSTRUCTOR"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const dispatch = await db.dispatch.findFirst({
    where: { id, aircraft: { organizationId: session.user.organizationId } },
    include: { aircraft: true },
  });
  if (!dispatch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (dispatch.status !== "PENDING") return NextResponse.json({ error: "Dispatch is not pending release" }, { status: 400 });
  if (dispatch.aircraft.status === "GROUNDED" || dispatch.aircraft.status === "IN_MAINTENANCE") {
    return NextResponse.json({ error: `${dispatch.aircraft.tailNumber} is not airworthy (${dispatch.aircraft.status.replaceAll("_", " ").toLowerCase()}).` }, { status: 409 });
  }

  const body = releaseSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "All release checks must be completed" }, { status: 400 });

  const updated = await db.dispatch.update({
    where: { id },
    data: {
      ...body.data,
      status: "RELEASED",
      releasedAt: new Date(),
      releasedBy: `${session.user.firstName} ${session.user.lastName}`,
      hobbsOut: dispatch.aircraft.currentHobbs,
      tachOut: dispatch.aircraft.currentTach,
      scheduleEvent: { update: { status: "DISPATCHED" } },
    },
  });

  return NextResponse.json({ dispatch: updated });
}
