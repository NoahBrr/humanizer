import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { computeFlightCharges, flightTimeFromHobbs } from "@/lib/billing";
import { resolvePricing, computeRentalCharge, legacyFallbackProfile, type PricingCandidate } from "@/lib/pricing";
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

  // Aircraft rental via the Phase 2 pricing resolver (doc 05 / ADR-030). Pure
  // resolution over profiles loaded BEFORE the transaction — no I/O added to the
  // atomic closeout (do-not-break rule 5). A zero-config org has no APPROVED
  // profiles, so the synthesized legacy fallback (L6) reproduces today's exact
  // wet-rate total; a profiled org bills its profile. The instructor line stays
  // on the legacy rate until Phase 3 brings instructor time entry into the review.
  const profiles = await db.aircraftPricingProfile.findMany({
    where: {
      organizationId: session.organizationId,
      status: "APPROVED",
      OR: [{ aircraftId: dispatch.aircraftId }, { aircraftId: null }],
    },
  });
  const candidates: PricingCandidate[] = [
    ...(profiles as unknown as PricingCandidate[]),
    legacyFallbackProfile(dispatch.aircraftId, dispatch.aircraft.hourlyRateWet.toString(), "USD"),
  ];
  const resolution = resolvePricing(candidates, {
    aircraftId: dispatch.aircraftId,
    explicitProfileId: dispatch.pricingProfileId,
    // NOTE: minimal Phase-2 context (studentId ⇒ "student"). The full
    // pricingFactsFor() deriver (membership roles, program, customer type from
    // Membership/Enrollment — doc 05 §5.4) lands with the pricing capture UI;
    // until then only L1/L4/L5/L6 and student-type L3 profiles resolve here.
    customerTypes: dispatch.studentId ? ["student"] : [],
    membershipRoles: [],
    programIds: [],
    locationId: dispatch.locationId,
  }, new Date());
  const profile = resolution.profile!;
  // The closeout captures Hobbs and Tach; it cannot yet capture custom-unit
  // quantities (a return-capture UI feature). Refuse rather than bill $0.
  if (profile.billingBasis === "CUSTOM_UNIT") {
    return NextResponse.json({ error: `Pricing profile "${profile.name}" bills by a custom unit, which this closeout can't capture yet. Select an Hobbs/Tach/fixed profile.` }, { status: 400 });
  }
  const tachOut = Number(dispatch.tachOut ?? dispatch.aircraft.currentTach);
  const rental = computeRentalCharge(profile, { hobbsOut, hobbsIn: data.hobbsIn, tachOut, tachIn: data.tachIn });
  // Keep the billed total in Decimal — never a JS float on the money path.
  const total = rental.amount.plus(charges.instructorCharge);
  const totalNum = total.toNumber();

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
            accountBalance: { decrement: total },
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
                  description: `${dispatch.aircraft.tailNumber} rental (${resolution.profile!.wetDry.toLowerCase()}) — ${rental.quantity.toString()} ${resolution.profile!.billingBasis.toLowerCase()} @ ${resolution.profile!.name}`,
                  quantity: rental.quantity,
                  unitPrice: rental.rateAmount,
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
      newValue: { tailNumber: dispatch.aircraft.tailNumber, flightTime, billed: totalNum, landings: data.landings, squawk: data.squawk?.title },
    });
    logger.info("flight closed", { dispatchId: id, flightTime, billed: totalNum });

    // One emission; the event bus fans out to webhooks, automations, and
    // any future consumer — this route doesn't know who is listening.
    await emitDomainEvent(session.organizationId, "flight.closed", {
      dispatchId: id, aircraftId: dispatch.aircraftId, tailNumber: dispatch.aircraft.tailNumber, flightTime, billed: totalNum,
    });

    return NextResponse.json({ dispatch: closed, flightTime, total: totalNum });
  } catch (e) {
    if (e instanceof DispatchAlreadyClosed) {
      return NextResponse.json({ error: "This dispatch has already been closed." }, { status: 409 });
    }
    logger.error("dispatch close failed", { dispatchId: id, error: String(e) });
    return NextResponse.json({ error: "The closeout could not be saved. Nothing was billed — please try again." }, { status: 500 });
  }
}
