import { db } from "@/lib/db";

/**
 * Operational forecast (Section 16C) — "what will happen tomorrow?".
 * Deterministic projections from tomorrow's confirmed bookings crossed with
 * fleet state: booked hours, aircraft and instructor demand, projected
 * revenue, and PREDICTED conflicts (an aircraft that will hit an inspection
 * limit mid-schedule, a grounded aircraft that still carries bookings, an
 * overloaded CFI) — surfaced before they become operational problems.
 * Same contract as every AeroOps engine: every number carries its basis.
 */
export type ForecastRisk = { level: "HIGH" | "ATTENTION"; message: string; basis: string };

export type OperationalForecast = {
  day: string; // ISO date being forecast
  flightsBooked: number;
  bookedHours: number;
  aircraftDemand: { needed: number; dispatchable: number };
  instructorLoad: { name: string; hours: number }[];
  projectedRevenue: number;
  risks: ForecastRisk[];
};

export async function buildOperationalForecast(organizationId: string): Promise<OperationalForecast> {
  const tomorrowStart = new Date();
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setHours(23, 59, 59, 999);

  const [events, aircraft] = await Promise.all([
    db.scheduleEvent.findMany({
      where: { organizationId, start: { gte: tomorrowStart, lte: tomorrowEnd }, status: "SCHEDULED" },
      include: {
        aircraft: { select: { id: true, tailNumber: true, hourlyRateWet: true } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    db.aircraft.findMany({
      where: { organizationId, isSimulator: false, status: { not: "RETIRED" } },
      include: {
        components: true,
        maintenance: { where: { status: "SCHEDULED", startDate: { lte: tomorrowEnd }, endDate: { gte: tomorrowStart } }, select: { title: true } },
      },
    }),
  ]);

  const hoursOf = (e: (typeof events)[number]) => (e.end.getTime() - e.start.getTime()) / 3_600_000;
  const bookedHours = events.reduce((t, e) => t + hoursOf(e), 0);

  // Per-aircraft booked hours tomorrow.
  const byAircraft = new Map<string, number>();
  for (const e of events) if (e.aircraft) byAircraft.set(e.aircraft.id, (byAircraft.get(e.aircraft.id) ?? 0) + hoursOf(e));

  // Per-instructor load tomorrow.
  const byInstructor = new Map<string, number>();
  for (const e of events) {
    if (!e.instructor) continue;
    const name = `${e.instructor.user.firstName} ${e.instructor.user.lastName}`;
    byInstructor.set(name, (byInstructor.get(name) ?? 0) + hoursOf(e));
  }

  const dispatchable = aircraft.filter((a) => !["GROUNDED", "IN_MAINTENANCE"].includes(a.status) && a.maintenance.length === 0).length;

  const risks: ForecastRisk[] = [];
  for (const a of aircraft) {
    const booked = byAircraft.get(a.id) ?? 0;
    const tails = a.tailNumber;

    if (booked > 0 && ["GROUNDED", "IN_MAINTENANCE"].includes(a.status)) {
      risks.push({
        level: "HIGH",
        message: `${tails} carries ${booked.toFixed(1)} booked hrs tomorrow but is ${a.status === "GROUNDED" ? "grounded" : "in the shop"}.`,
        basis: `Reassign those lessons or expedite return-to-service — ${events.filter((e) => e.aircraft?.id === a.id).length} booking(s) affected.`,
      });
      continue;
    }
    if (booked > 0 && a.maintenance.length > 0) {
      risks.push({
        level: "HIGH",
        message: `${tails} has maintenance ("${a.maintenance[0].title}") scheduled tomorrow AND ${booked.toFixed(1)} booked flight hrs.`,
        basis: "Maintenance window and bookings overlap — move one of them today.",
      });
    }
    const hobbs = Number(a.currentHobbs);
    const margins = a.components
      .filter((c) => c.dueAtHours !== null && c.dueAtHours !== undefined)
      .map((c) => ({ name: c.name, left: Number(c.dueAtHours) - hobbs }));
    const tightest = margins.sort((x, y) => x.left - y.left)[0];
    if (tightest && booked > 0 && tightest.left <= booked) {
      risks.push({
        level: "HIGH",
        message: `${tails} will hit its ${tightest.name} limit during tomorrow's schedule.`,
        basis: `${tightest.left.toFixed(1)} hrs of margin vs ${booked.toFixed(1)} hrs booked — swap the later lessons to another aircraft or bring the inspection forward.`,
      });
    } else if (tightest && tightest.left <= booked + 5 && booked > 0) {
      risks.push({
        level: "ATTENTION",
        message: `${tails} finishes tomorrow with under 5 hrs to its ${tightest.name}.`,
        basis: `${tightest.left.toFixed(1)} hrs margin, ${booked.toFixed(1)} hrs booked — plan the inspection slot now.`,
      });
    }
  }
  for (const [name, hours] of byInstructor) {
    if (hours > 8) {
      risks.push({
        level: "ATTENTION",
        message: `${name} is booked ${hours.toFixed(1)} hrs tomorrow.`,
        basis: "Above the 8-hr instructional-day guideline — consider redistributing a lesson.",
      });
    }
  }
  risks.sort((a, b) => (a.level === b.level ? 0 : a.level === "HIGH" ? -1 : 1));

  return {
    day: tomorrowStart.toISOString(),
    flightsBooked: events.length,
    bookedHours,
    aircraftDemand: { needed: byAircraft.size, dispatchable },
    instructorLoad: [...byInstructor.entries()].map(([name, hours]) => ({ name, hours })).sort((a, b) => b.hours - a.hours),
    projectedRevenue: events.reduce((t, e) => t + (e.aircraft ? hoursOf(e) * Number(e.aircraft.hourlyRateWet) : 0), 0),
    risks,
  };
}
