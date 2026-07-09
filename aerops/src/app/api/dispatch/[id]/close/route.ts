import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { computeFlightCharges, flightTimeFromHobbs } from "@/lib/billing";
import { emitDomainEvent } from "@/lib/events";

const closeSchema = z.object({
  hobbsIn: z.number().positive(),
  tachIn: z.number().positive(),
  landings: z.number().int().min(0),
  nightTime: z.number().min(0).default(0),
  instrumentTime: z.number().min(0).default(0),
  fuelAddedGal: z.number().min(0).default(0),
  squawk: z.object({ title: z.string().min(3), description: z.string().optional(), severity: z.enum(["GROUNDING", "MAJOR", "MINOR"]) }).nullish(),
});

/** Thrown inside the closeout transaction when the atomic RELEASED→CLOSED
 *  claim matches no row — i.e. a concurrent request already closed it. It
 *  aborts the transaction so nothing is billed or metered a second time. */
class DispatchAlreadyClosed extends Error {}

/**
 * Close out a flight: compute billable time from hobbs, roll the aircraft
 * meters forward, log pilot time, generate the invoice, and update the
 * student's balance — one transaction.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("dispatch.close", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const dispatch = await db.dispatch.findFirst({
    where: { id, aircraft: { organizationId: session.organizationId } },
    include: { aircraft: true, instructor: true, student: true, scheduleEvent: true },
  });
  if (!dispatch) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (dispatch.status !== "RELEASED") return NextResponse.json({ error: "Dispatch is not released" }, { status: 400 });

  const body = closeSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  const hobbsOut = Number(dispatch.hobbsOut ?? dispatch.aircraft.currentHobbs);
  let flightTime: number;
  try {
    flightTime = flightTimeFromHobbs(hobbsOut, data.hobbsIn);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const isDual = !!dispatch.instructorId;
  const charges = computeFlightCharges({
    flightTime,
    aircraftHourlyRate: Number(dispatch.aircraft.hourlyRateWet),
    instructorHourlyRate: dispatch.instructor ? Number(dispatch.instructor.hourlyRate) : 0,
    isDual,
  });

  const invoiceNumber = `INV-${Date.now().toString().slice(-8)}`;

  try {
    const closed = await db.$transaction(async (tx) => {
      // Atomic claim: flip RELEASED→CLOSED as a guarded updateMany. Only the
      // request that actually transitions the row proceeds; a concurrent
      // double-submit matches zero rows here and aborts the transaction, so
      // the invoice, balance decrement, and meter increments happen exactly
      // once (idempotent closeout — do-not-break rule 5).
      const claim = await tx.dispatch.updateMany({
        where: { id, status: "RELEASED" },
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
        },
      });
      if (claim.count === 0) throw new DispatchAlreadyClosed();

      if (dispatch.scheduleEvent) {
        await tx.scheduleEvent.update({ where: { id: dispatch.scheduleEvent.id }, data: { status: "COMPLETED" } });
      }

      await tx.aircraft.update({
        where: { id: dispatch.aircraftId },
        data: {
          currentHobbs: data.hobbsIn,
          currentTach: data.tachIn,
          engineTimeSmoh: { increment: flightTime },
          propTimeSpoh: { increment: flightTime },
        },
      });

      if (dispatch.studentId) {
        await tx.student.update({
          where: { id: dispatch.studentId },
          data: {
            totalHours: { increment: flightTime },
            ...(isDual ? {} : { soloHours: { increment: flightTime } }),
            accountBalance: { decrement: charges.total },
          },
        });
        await tx.invoice.create({
          data: {
            organizationId: session.organizationId,
            studentId: dispatch.studentId,
            number: invoiceNumber,
            status: "OPEN",
            dueAt: new Date(Date.now() + 14 * 86_400_000),
            lines: {
              create: [
                {
                  kind: "AIRCRAFT_RENTAL",
                  description: `${dispatch.aircraft.tailNumber} rental (wet) — ${flightTime.toFixed(1)} hrs`,
                  quantity: flightTime,
                  unitPrice: dispatch.aircraft.hourlyRateWet,
                },
                ...(isDual
                  ? [{
                      kind: "INSTRUCTOR_TIME" as const,
                      description: `Flight instruction — ${charges.instructorHours.toFixed(1)} hrs`,
                      quantity: charges.instructorHours,
                      unitPrice: dispatch.instructor!.hourlyRate,
                    }]
                  : []),
              ],
            },
          },
        });
      }

      if (data.squawk) {
        await tx.squawk.create({
          data: { aircraftId: dispatch.aircraftId, title: data.squawk.title, description: data.squawk.description, severity: data.squawk.severity },
        });
        await tx.notification.create({
          data: {
            organizationId: session.organizationId,
            kind: "SQUAWK_REPORTED",
            title: `New squawk on ${dispatch.aircraft.tailNumber}`,
            body: data.squawk.title,
          },
        });
        if (data.squawk.severity === "GROUNDING") {
          await tx.aircraft.update({ where: { id: dispatch.aircraftId }, data: { status: "GROUNDED" } });
        }
      }

      // Return the freshly-closed row for the response payload.
      return tx.dispatch.findUniqueOrThrow({ where: { id } });
    });

    await recordAudit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      actorLabel: `${session.firstName} ${session.lastName}`,
      action: "dispatch.close",
      entityType: "Dispatch",
      entityId: id,
      newValue: { tailNumber: dispatch.aircraft.tailNumber, flightTime, billed: charges.total, landings: data.landings, squawk: data.squawk?.title },
    });
    logger.info("flight closed", { dispatchId: id, flightTime, billed: charges.total });

    // One emission; the event bus fans out to webhooks, automations, and
    // any future consumer — this route doesn't know who is listening.
    await emitDomainEvent(session.organizationId, "flight.closed", {
      dispatchId: id, aircraftId: dispatch.aircraftId, tailNumber: dispatch.aircraft.tailNumber, flightTime, billed: charges.total,
    });

    return NextResponse.json({ dispatch: closed, flightTime, total: charges.total });
  } catch (e) {
    if (e instanceof DispatchAlreadyClosed) {
      return NextResponse.json({ error: "This dispatch has already been closed." }, { status: 409 });
    }
    logger.error("dispatch close failed", { dispatchId: id, error: String(e) });
    return NextResponse.json({ error: "The closeout could not be saved. Nothing was billed — please try again." }, { status: 500 });
  }
}
