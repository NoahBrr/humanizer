import { db } from "@/lib/db";

export type ConflictInput = {
  organizationId: string;
  start: Date;
  end: Date;
  aircraftId?: string | null;
  instructorId?: string | null;
  studentId?: string | null;
  excludeEventId?: string | null;
};

export type Conflict = {
  kind: "AIRCRAFT_DOUBLE_BOOKED" | "INSTRUCTOR_DOUBLE_BOOKED" | "STUDENT_DOUBLE_BOOKED" | "MAINTENANCE_CONFLICT" | "AIRCRAFT_GROUNDED";
  message: string;
};

const ACTIVE_STATUSES = ["SCHEDULED", "DISPATCHED", "IN_FLIGHT"] as const;

/**
 * Detect every scheduling conflict for a proposed booking window: resource
 * double-bookings, maintenance overlap, and grounded/maintenance aircraft.
 */
export async function detectConflicts(input: ConflictInput): Promise<Conflict[]> {
  const { organizationId, start, end, aircraftId, instructorId, studentId, excludeEventId } = input;
  const conflicts: Conflict[] = [];

  const overlap = {
    organizationId,
    id: excludeEventId ? { not: excludeEventId } : undefined,
    status: { in: [...ACTIVE_STATUSES] },
    start: { lt: end },
    end: { gt: start },
  };

  const [events, aircraft, maintenance] = await Promise.all([
    db.scheduleEvent.findMany({
      where: {
        ...overlap,
        OR: [
          ...(aircraftId ? [{ aircraftId }] : []),
          ...(instructorId ? [{ instructorId }] : []),
          ...(studentId ? [{ studentId }] : []),
        ],
      },
      include: {
        aircraft: { select: { tailNumber: true } },
        instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
        student: { include: { user: { select: { firstName: true, lastName: true } } } },
      },
    }),
    aircraftId ? db.aircraft.findUnique({ where: { id: aircraftId } }) : null,
    aircraftId
      ? db.maintenanceOrder.findFirst({
          where: {
            aircraftId,
            status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            startDate: { lt: end },
            OR: [{ endDate: null }, { endDate: { gt: start } }],
          },
        })
      : null,
  ]);

  for (const e of events) {
    const when = `${e.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}–${e.end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    if (aircraftId && e.aircraftId === aircraftId) {
      conflicts.push({ kind: "AIRCRAFT_DOUBLE_BOOKED", message: `${e.aircraft?.tailNumber} is already booked ${when}.` });
    }
    if (instructorId && e.instructorId === instructorId) {
      conflicts.push({ kind: "INSTRUCTOR_DOUBLE_BOOKED", message: `${e.instructor ? `${e.instructor.user.firstName} ${e.instructor.user.lastName}` : "Instructor"} is already booked ${when}.` });
    }
    if (studentId && e.studentId === studentId) {
      conflicts.push({ kind: "STUDENT_DOUBLE_BOOKED", message: `${e.student ? `${e.student.user.firstName} ${e.student.user.lastName}` : "Student"} is already booked ${when}.` });
    }
  }

  if (aircraft && (aircraft.status === "GROUNDED" || aircraft.status === "IN_MAINTENANCE" || aircraft.status === "RETIRED")) {
    conflicts.push({ kind: "AIRCRAFT_GROUNDED", message: `${aircraft.tailNumber} is ${aircraft.status.replaceAll("_", " ").toLowerCase()} and cannot be scheduled.` });
  }
  if (maintenance) {
    conflicts.push({ kind: "MAINTENANCE_CONFLICT", message: `Maintenance "${maintenance.title}" overlaps this window.` });
  }

  return conflicts;
}

/**
 * Suggest up to `limit` alternative same-duration slots (30-minute steps,
 * 07:00–19:00, up to 3 days out) where the same resources are free.
 */
export async function suggestAlternatives(input: ConflictInput, limit = 3) {
  const durationMs = input.end.getTime() - input.start.getTime();
  const suggestions: { start: Date; end: Date }[] = [];

  for (let dayOffset = 0; dayOffset <= 3 && suggestions.length < limit; dayOffset++) {
    const dayStart = new Date(input.start);
    dayStart.setDate(dayStart.getDate() + dayOffset);
    dayStart.setHours(7, 0, 0, 0);

    for (let step = 0; step < 24 && suggestions.length < limit; step++) {
      const candidateStart = new Date(dayStart.getTime() + step * 30 * 60_000);
      const candidateEnd = new Date(candidateStart.getTime() + durationMs);
      if (candidateEnd.getHours() >= 20 && candidateEnd.getMinutes() > 0) break;
      if (candidateStart <= new Date()) continue;
      if (dayOffset === 0 && Math.abs(candidateStart.getTime() - input.start.getTime()) < 60_000) continue;

      const found = await detectConflicts({ ...input, start: candidateStart, end: candidateEnd });
      if (found.length === 0) suggestions.push({ start: candidateStart, end: candidateEnd });
    }
  }
  return suggestions;
}
