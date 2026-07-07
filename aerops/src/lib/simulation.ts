import {
  EventStatus, EventType, InvoiceStatus, LineItemKind, NotificationKind,
  PaymentMethod, SquawkSeverity, SquawkStatus, AircraftStatus, DispatchStatus,
  MaintenanceStatus,
} from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Live Simulation Engine.
 *
 * A simulation run targets one organization and a scenario. Each tick applies
 * a weighted batch of realistic operational activity — dispatches, flight
 * completions with invoices, new reservations, weather, squawks, payments,
 * check-ins and AI insights — so Mission Control and the org dashboards feel
 * alive during demos. Ticks are idempotent-ish and bounded, so a runaway
 * client can't flood a tenant.
 */

export type ScenarioKey =
  | "morning-rush" | "busy-weekend" | "weather-event" | "maintenance-crisis"
  | "checkride-week" | "university-semester" | "flying-club-weekend" | "charter-surge";

type ActionKey =
  | "dispatch" | "complete" | "reserve" | "weather" | "squawk"
  | "payment" | "checkin" | "insight" | "checkride";

export const SCENARIOS: Record<ScenarioKey, { label: string; description: string; weights: Partial<Record<ActionKey, number>> }> = {
  "morning-rush": {
    label: "Morning Rush",
    description: "Back-to-back departures, students checking in, dispatch under pressure.",
    weights: { dispatch: 3, complete: 1.5, reserve: 1, checkin: 2.5, payment: 1, insight: 0.7 },
  },
  "busy-weekend": {
    label: "Busy Weekend",
    description: "Full schedule, walk-in bookings, high aircraft utilization.",
    weights: { dispatch: 2, complete: 2, reserve: 2.5, checkin: 1.5, payment: 1.5, insight: 0.7, squawk: 0.5 },
  },
  "weather-event": {
    label: "Weather Event",
    description: "A front moves through: cancellations, reschedules, weather alerts.",
    weights: { weather: 3, reserve: 1, dispatch: 0.5, insight: 1.2, checkin: 0.5 },
  },
  "maintenance-crisis": {
    label: "Maintenance Crisis",
    description: "Squawks pile up, aircraft grounded, schedule shuffles around downed tails.",
    weights: { squawk: 3, weather: 0.2, dispatch: 1, complete: 1, insight: 1.2, reserve: 0.7 },
  },
  "checkride-week": {
    label: "Checkride Week",
    description: "Stage checks and DPE appointments; instructors polishing applicants.",
    weights: { checkride: 2.5, dispatch: 1.5, complete: 1.5, checkin: 1, insight: 1, payment: 1 },
  },
  "university-semester": {
    label: "University Semester",
    description: "Cohort flying at scale — steady high-volume operations all day.",
    weights: { dispatch: 2.5, complete: 2.5, reserve: 2, checkin: 2, payment: 1.5, squawk: 0.7, insight: 0.8 },
  },
  "flying-club-weekend": {
    label: "Flying Club Weekend",
    description: "Members grabbing airplanes for breakfast runs and proficiency flights.",
    weights: { reserve: 2.5, dispatch: 1.5, complete: 1.5, payment: 1, insight: 0.5 },
  },
  "charter-surge": {
    label: "Charter Surge",
    description: "Quote requests convert into trips; jets turning quickly, revenue climbing.",
    weights: { reserve: 3, dispatch: 2, complete: 2, payment: 2.5, insight: 1 },
  },
};

const rand = Math.random;
const rint = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const rnum = (min: number, max: number, dp = 1) => Math.round((rand() * (max - min) + min) * 10 ** dp) / 10 ** dp;
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];

function weightedActions(weights: Partial<Record<ActionKey, number>>, count: number): ActionKey[] {
  const entries = Object.entries(weights) as [ActionKey, number][];
  const total = entries.reduce((t, [, w]) => t + w, 0);
  const out: ActionKey[] = [];
  for (let i = 0; i < count; i++) {
    let roll = rand() * total;
    for (const [key, w] of entries) {
      roll -= w;
      if (roll <= 0) { out.push(key); break; }
    }
  }
  return out;
}

export type TickResult = {
  runId: string;
  tick: number;
  feed: { at: string; kind: string; message: string }[];
};

/** Apply one tick of simulated activity. Returns a human-readable feed. */
export async function simulationTick(runId: string): Promise<TickResult | null> {
  const run = await db.simulationRun.findUnique({ where: { id: runId }, include: { organization: { select: { id: true, name: true } } } });
  if (!run || run.status !== "RUNNING") return null;
  const organizationId = run.organizationId;
  const scenario = SCENARIOS[run.scenario as ScenarioKey] ?? SCENARIOS["busy-weekend"];

  const [fleet, students, instructors, lessonTypes] = await Promise.all([
    db.aircraft.findMany({ where: { organizationId, isSimulator: false }, select: { id: true, tailNumber: true, status: true, hourlyRateWet: true, currentHobbs: true } }),
    db.student.findMany({ where: { user: { organizationId } }, select: { id: true, user: { select: { firstName: true, lastName: true } } }, take: 400 }),
    db.instructor.findMany({ where: { user: { organizationId } }, select: { id: true, hourlyRate: true, user: { select: { firstName: true, lastName: true } } } }),
    db.lessonType.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);
  if (!fleet.length || !students.length) return { runId, tick: run.tickCount, feed: [{ at: new Date().toISOString(), kind: "warn", message: "Organization has no fleet/people to simulate — generate demo data first." }] };

  const feed: TickResult["feed"] = [];
  const say = (kind: string, message: string) => feed.push({ at: new Date().toISOString(), kind, message });
  const studentName = (s: (typeof students)[number]) => `${s.user.firstName} ${s.user.lastName}`;
  const now = new Date();

  const actions = weightedActions(scenario.weights, rint(3, 5));

  for (const action of actions) {
    try {
      switch (action) {
        case "dispatch": {
          // move a scheduled (or just-created) event into DISPATCHED / IN_FLIGHT
          const ev = await db.scheduleEvent.findFirst({
            where: { organizationId, status: EventStatus.SCHEDULED, aircraftId: { not: null }, start: { lte: new Date(now.getTime() + 3 * 3600_000) } },
            orderBy: { start: "asc" },
            include: { aircraft: { select: { tailNumber: true } } },
          });
          if (!ev) break;
          const toFlight = rand() > 0.4;
          await db.scheduleEvent.update({ where: { id: ev.id }, data: { status: toFlight ? EventStatus.IN_FLIGHT : EventStatus.DISPATCHED } });
          await db.dispatch.upsert({
            where: { scheduleEventId: ev.id },
            update: { status: DispatchStatus.RELEASED, releasedAt: now, releasedBy: "Simulation Dispatch" },
            create: {
              scheduleEventId: ev.id, aircraftId: ev.aircraftId!, studentId: ev.studentId, instructorId: ev.instructorId,
              status: DispatchStatus.RELEASED, fuelQty: "Full tanks", oilQty: "7 qt",
              weatherAcknowledged: true, documentsVerified: true, instructorApproved: true, studentApproved: true,
              releasedAt: now, releasedBy: "Simulation Dispatch",
            },
          });
          say("dispatch", `${ev.aircraft?.tailNumber} ${toFlight ? "airborne" : "released for departure"}.`);
          break;
        }
        case "complete": {
          const ev = await db.scheduleEvent.findFirst({
            where: { organizationId, status: { in: [EventStatus.IN_FLIGHT, EventStatus.DISPATCHED] }, aircraftId: { not: null } },
            include: { aircraft: true, instructor: true },
          });
          if (!ev) break;
          const flightTime = rnum(0.8, 2.2, 1);
          await db.scheduleEvent.update({ where: { id: ev.id }, data: { status: EventStatus.COMPLETED } });
          await db.dispatch.updateMany({ where: { scheduleEventId: ev.id }, data: { status: DispatchStatus.CLOSED, closedAt: now, flightTime, landings: rint(1, 6) } });
          await db.aircraft.update({ where: { id: ev.aircraftId! }, data: { currentHobbs: { increment: flightTime } } });
          if (ev.studentId) {
            const number = `INV-SIM-${Date.now().toString(36).toUpperCase()}${rint(10, 99)}`;
            await db.invoice.create({
              data: {
                organizationId, studentId: ev.studentId, number, status: InvoiceStatus.OPEN, issuedAt: now,
                dueAt: new Date(now.getTime() + 14 * 86400_000),
                lines: {
                  create: [
                    { kind: LineItemKind.AIRCRAFT_RENTAL, description: `${ev.aircraft!.tailNumber} rental (wet) — ${flightTime} hrs`, quantity: flightTime, unitPrice: ev.aircraft!.hourlyRateWet },
                    ...(ev.instructor ? [{ kind: LineItemKind.INSTRUCTOR_TIME, description: `Instruction — ${flightTime + 0.3} hrs`, quantity: flightTime + 0.3, unitPrice: ev.instructor.hourlyRate }] : []),
                  ],
                },
              },
            });
          }
          say("flight", `${ev.aircraft?.tailNumber} landed — ${flightTime.toFixed(1)} hrs logged, invoice issued.`);
          break;
        }
        case "reserve": {
          const st = pick(students);
          const ac = pick(fleet.filter((a) => a.status === AircraftStatus.AVAILABLE));
          if (!ac) break;
          const inst = instructors.length && rand() > 0.5 ? pick(instructors) : null;
          const startH = rint(1, 72);
          const start = new Date(now.getTime() + startH * 3600_000);
          const end = new Date(start.getTime() + rnum(1, 2.5, 1) * 3600_000);
          await db.scheduleEvent.create({
            data: {
              organizationId, type: inst ? EventType.FLIGHT_LESSON : EventType.RENTAL, status: EventStatus.SCHEDULED,
              start, end, aircraftId: ac.id, instructorId: inst?.id ?? null, studentId: st.id,
              lessonTypeId: lessonTypes[0]?.id ?? null,
            },
          });
          say("booking", `New reservation: ${studentName(st)} on ${ac.tailNumber} ${startH < 24 ? "today/tomorrow" : `in ${Math.round(startH / 24)} days`}.`);
          break;
        }
        case "weather": {
          const upcoming = await db.scheduleEvent.findMany({
            where: { organizationId, status: EventStatus.SCHEDULED, start: { gte: now, lte: new Date(now.getTime() + 6 * 3600_000) } },
            take: rint(1, 3),
            include: { aircraft: { select: { tailNumber: true } } },
          });
          const reason = pick(["Ceilings 600 OVC, below minimums", "Gusts 26G39 across the runway", "Convective SIGMET within 15nm", "Freezing rain — airframe icing risk"]);
          for (const ev of upcoming) {
            await db.scheduleEvent.update({ where: { id: ev.id }, data: { status: EventStatus.WEATHER_CANCELLED, cancellationReason: reason } });
          }
          await db.notification.create({
            data: { organizationId, kind: NotificationKind.WEATHER_CANCELLATION, title: "Weather alert", body: `${reason}. ${upcoming.length} flight(s) cancelled.` },
          });
          say("weather", `Weather: ${reason} — ${upcoming.length} flight(s) cancelled.`);
          break;
        }
        case "squawk": {
          const ac = pick(fleet);
          const [title, severity] = pick([
            ["Right magneto drop excessive", SquawkSeverity.GROUNDING],
            ["Alternator overcharging", SquawkSeverity.GROUNDING],
            ["Attitude indicator sluggish", SquawkSeverity.MAJOR],
            ["Left brake spongy", SquawkSeverity.MAJOR],
            ["Beacon light inoperative", SquawkSeverity.MINOR],
            ["Cabin vent stuck closed", SquawkSeverity.MINOR],
          ] as [string, SquawkSeverity][]);
          await db.squawk.create({ data: { aircraftId: ac.id, title, severity, status: SquawkStatus.OPEN } });
          if (severity === SquawkSeverity.GROUNDING) {
            await db.aircraft.update({ where: { id: ac.id }, data: { status: AircraftStatus.GROUNDED } });
            await db.maintenanceOrder.create({ data: { aircraftId: ac.id, title: `Troubleshoot: ${title}`, status: MaintenanceStatus.IN_PROGRESS, startDate: now } });
            await db.notification.create({ data: { organizationId, kind: NotificationKind.AIRCRAFT_GROUNDED, title: `${ac.tailNumber} grounded`, body: `${title} — removed from schedule pending maintenance.` } });
            say("maintenance", `${ac.tailNumber} GROUNDED: ${title}. Work order opened.`);
          } else {
            await db.notification.create({ data: { organizationId, kind: NotificationKind.SQUAWK_REPORTED, title: `New squawk on ${ac.tailNumber}`, body: title } });
            say("maintenance", `Squawk reported on ${ac.tailNumber}: ${title}.`);
          }
          break;
        }
        case "payment": {
          const inv = await db.invoice.findFirst({
            where: { organizationId, status: { in: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE] } },
            include: { lines: true, student: { include: { user: { select: { firstName: true, lastName: true } } } } },
          });
          if (!inv) break;
          const total = inv.lines.reduce((t, l) => t + Number(l.quantity) * Number(l.unitPrice), 0);
          await db.payment.create({ data: { invoiceId: inv.id, amount: Math.round(total * 100) / 100, method: pick([PaymentMethod.CARD, PaymentMethod.ACH]), reference: `pi_sim_${Math.random().toString(36).slice(2, 10)}` } });
          await db.invoice.update({ where: { id: inv.id }, data: { status: InvoiceStatus.PAID } });
          say("revenue", `Payment received: $${total.toFixed(2)} from ${inv.student ? `${inv.student.user.firstName} ${inv.student.user.lastName}` : "account"} (${inv.number}).`);
          break;
        }
        case "checkin": {
          const st = pick(students);
          await db.notification.create({
            data: { organizationId, kind: NotificationKind.UPCOMING_FLIGHT, title: `${studentName(st)} checked in`, body: "At the front desk for an upcoming flight." },
          });
          say("checkin", `${studentName(st)} checked in at the front desk.`);
          break;
        }
        case "checkride": {
          const st = pick(students);
          const passed = rand() > 0.25;
          await db.notification.create({
            data: {
              organizationId, kind: NotificationKind.GENERAL,
              title: passed ? `Checkride PASSED — ${studentName(st)}` : `Checkride discontinued — ${studentName(st)}`,
              body: passed ? "New certificate earned. Congratulations are in order!" : "Weather discontinuance; rescheduling with the DPE.",
            },
          });
          say("training", passed ? `${studentName(st)} passed their checkride! 🎉` : `${studentName(st)}'s checkride discontinued (weather).`);
          break;
        }
        case "insight": {
          const insight = pick([
            "Utilization on the 172 fleet is trending 12% above last month — consider opening early-morning blocks.",
            "Three students are within 5 hours of checkride minimums. Schedule stage checks this week.",
            "Overdue receivables exceed $2,400 — automatic reminders recommended.",
            `Maintenance forecast: 2 aircraft reach 100-hour limits within ${rint(4, 9)} days.`,
            "Weekend demand exceeds instructor availability by ~3 slots. Consider adding a Saturday CFI shift.",
          ]);
          await db.notification.create({ data: { organizationId, kind: NotificationKind.GENERAL, title: "AeroOps AI recommendation", body: insight } });
          say("ai", `AI: ${insight}`);
          break;
        }
      }
    } catch (e) {
      console.error(`simulation action ${action} failed`, e);
    }
  }

  const updated = await db.simulationRun.update({
    where: { id: runId },
    data: { tickCount: { increment: 1 }, eventsCreated: { increment: feed.length }, lastTickAt: now },
  });

  return { runId, tick: updated.tickCount, feed };
}
