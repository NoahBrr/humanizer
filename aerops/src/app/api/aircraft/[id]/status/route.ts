import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";

const patchSchema = z.object({
  status: z.enum(["AVAILABLE", "IN_MAINTENANCE", "GROUNDED", "RESERVED", "RETIRED"]),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "MAINTENANCE", "DISPATCHER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const aircraft = await db.aircraft.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!aircraft) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const updated = await db.aircraft.update({ where: { id }, data: { status: body.data.status } });

  if (body.data.status === "GROUNDED") {
    await db.notification.create({
      data: {
        organizationId: session.user.organizationId,
        kind: "AIRCRAFT_GROUNDED",
        title: `${aircraft.tailNumber} grounded`,
        body: `Grounded by ${session.user.firstName} ${session.user.lastName}. Upcoming bookings need review.`,
      },
    });
  }

  return NextResponse.json({ aircraft: updated });
}
