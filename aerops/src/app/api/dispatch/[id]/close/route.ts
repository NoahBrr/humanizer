import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";

const closeSchema = z.object({
  hobbsIn: z.number().positive(),
  tachIn: z.number().positive(),
  landings: z.number().int().min(0),
  nightTime: z.number().min(0).default(0),
  instrumentTime: z.number().min(0).default(0),
  fuelAddedGal: z.number().min(0).default(0),
  squawk: z.object({ title: z.string().min(3), description: z.string().optional(), severity: z.enum(["GROUNDING", "MAJOR", "MINOR"]) }).nullish(),
});

/**
 * Close out a flight: compute billable time from hobbs, roll the aircraft
 * meters forward, log pilot time, generate the invoice, and update the
 * student's balance — one transaction.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "DISPATCHER", "INSTRUCTOR"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const dispatch = await db.dispatch.findFirst({
    where: { id, aircraft: { organizationId: session.user.organizationId } },
    include: { aircraft: true, instructor: true, student: true, scheduleEvent: true },
  });
  if (!dispatch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (dispatch.status !== "RELEASED") return NextResponse.json({ error: "Dispatch is not released" }, { status: 400 });

  const body = closeSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  const hobbsOut = Number(dispatch.hobbsOut ?? dispatch.aircraft.currentHobbs);
  if (data.hobbsIn <= hobbsOut) {
    return NextResponse.json({ error: `Hobbs in (${data.hobbsIn.toFixed(1)}) must exceed hobbs out (${hobbsOut.toFixed(1)})` }, { status: 400 });
  }
  const flightTime = Math.round((data.hobbsIn - hobbsOut) * 10) / 10;
  const isDual = !!dispatch.instructorId;
  const cfiRate = dispatch.instructor ? Number(dispatch.instructor.hourlyRate) : 0;
  const acRate = Number(dispatch.aircraft.hourlyRateWet);
  const acCharge = Math.round(flightTime * acRate * 100) / 100;
  const cfiHours = isDual ? Math.round((flightTime + 0.5) * 10) / 10 : 0; // brief/debrief padding
  const cfiCharge = Math.round(cfiHours * cfiRate * 100) / 100;
  const total = acCharge + cfiCharge;

  const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

  const [closed] = await db.$transaction([
    db.dispatch.update({
      where: { id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        hobbsIn: data.hobbsIn,
        tachIn: data.tachIn,
        flightTime,
        landings: data.landings,
        nightTime: data.nightTime,
        instrumentTime: data.instrumentTime,
        fuelAddedGal: data.fuelAddedGal,
        dualReceived: isDual ? flightTime : null,
        dualGiven: isDual ? flightTime : null,
        picTime: isDual ? null : flightTime,
        scheduleEvent: { update: { status: "COMPLETED" } },
      },
    }),
    db.aircraft.update({
      where: { id: dispatch.aircraftId },
      data: {
        currentHobbs: data.hobbsIn,
        currentTach: data.tachIn,
        engineTimeSmoh: { increment: flightTime },
        propTimeSpoh: { increment: flightTime },
      },
    }),
    ...(dispatch.studentId
      ? [
          db.student.update({
            where: { id: dispatch.studentId },
            data: {
              totalHours: { increment: flightTime },
              ...(isDual ? {} : { soloHours: { increment: flightTime } }),
              accountBalance: { decrement: total },
            },
          }),
          db.invoice.create({
            data: {
              organizationId: session.user.organizationId,
              studentId: dispatch.studentId,
              number: invoiceNumber,
              status: "OPEN",
              dueAt: new Date(Date.now() + 14 * 86_400_000),
              lines: {
                create: [
                  { kind: "AIRCRAFT_RENTAL", description: `${dispatch.aircraft.tailNumber} rental (wet) — ${flightTime.toFixed(1)} hrs`, quantity: flightTime, unitPrice: acRate },
                  ...(isDual ? [{ kind: "INSTRUCTOR_TIME" as const, description: `Flight instruction — ${cfiHours.toFixed(1)} hrs`, quantity: cfiHours, unitPrice: cfiRate }] : []),
                ],
              },
            },
          }),
        ]
      : []),
    ...(data.squawk
      ? [
          db.squawk.create({
            data: { aircraftId: dispatch.aircraftId, title: data.squawk.title, description: data.squawk.description, severity: data.squawk.severity },
          }),
          db.notification.create({
            data: {
              organizationId: session.user.organizationId,
              kind: "SQUAWK_REPORTED",
              title: `New squawk on ${dispatch.aircraft.tailNumber}`,
              body: data.squawk.title,
            },
          }),
          ...(data.squawk.severity === "GROUNDING"
            ? [db.aircraft.update({ where: { id: dispatch.aircraftId }, data: { status: "GROUNDED" } })]
            : []),
        ]
      : []),
  ]);

  return NextResponse.json({ dispatch: closed, flightTime, total });
}
