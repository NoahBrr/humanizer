import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { detectConflicts, suggestAlternatives, suggestResources } from "@/lib/scheduling";
import { randomUUID } from "crypto";

const eventInclude = {
  aircraft: { select: { id: true, tailNumber: true } },
  instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
  student: { include: { user: { select: { firstName: true, lastName: true } } } },
  lessonType: { select: { id: true, name: true, color: true } },
} as const;

export async function GET(req: Request) {
  const { session, error } = await authorize("schedule.view");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  // Location switcher (topbar) scopes the calendar to one base.
  const { cookies } = await import("next/headers");
  const locationId = (await cookies()).get("aerops-location")?.value || undefined;

  const events = await db.scheduleEvent.findMany({
    where: {
      organizationId: session.organizationId,
      ...(locationId ? { locationId } : {}),
      ...(start && end ? { start: { lt: new Date(end) }, end: { gt: new Date(start) } } : {}),
    },
    include: eventInclude,
    orderBy: { start: "asc" },
    take: 1000,
  });

  return NextResponse.json({ events });
}

const createSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  type: z.enum(["FLIGHT_LESSON", "SOLO_FLIGHT", "GROUND_LESSON", "SIMULATOR", "CHECKRIDE", "RENTAL", "MEETING"]).default("FLIGHT_LESSON"),
  aircraftId: z.string().nullish(),
  instructorId: z.string().nullish(),
  studentId: z.string().nullish(),
  lessonTypeId: z.string().nullish(),
  notes: z.string().nullish(),
  force: z.boolean().default(false),
  recurrence: z.object({ freq: z.enum(["WEEKLY", "BIWEEKLY"]), count: z.number().int().min(2).max(26) }).nullish(),
});

export async function POST(req: Request) {
  const { session, error } = await authorize("schedule.create", { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;
  const organizationId = session.organizationId;
  const start = new Date(data.start);
  const end = new Date(data.end);

  if (end <= start) return NextResponse.json({ error: "End must be after start" }, { status: 400 });

  // Never trust body-supplied FKs: every referenced resource must belong to
  // this org, or we'd store a dangling cross-tenant reference and leak the
  // foreign row's name/tail back through the schedule read (tenant isolation).
  const [okAircraft, okInstructor, okStudent, okLessonType] = await Promise.all([
    data.aircraftId ? db.aircraft.findFirst({ where: { id: data.aircraftId, organizationId }, select: { id: true } }) : Promise.resolve(true),
    data.instructorId ? db.instructor.findFirst({ where: { id: data.instructorId, user: { organizationId } }, select: { id: true } }) : Promise.resolve(true),
    data.studentId ? db.student.findFirst({ where: { id: data.studentId, user: { organizationId } }, select: { id: true } }) : Promise.resolve(true),
    data.lessonTypeId ? db.lessonType.findFirst({ where: { id: data.lessonTypeId, organizationId }, select: { id: true } }) : Promise.resolve(true),
  ]);
  if (!okAircraft || !okInstructor || !okStudent || !okLessonType) {
    return NextResponse.json({ error: "One or more selected resources are not part of your organization." }, { status: 400 });
  }

  const conflictInput = { organizationId, start, end, aircraftId: data.aircraftId, instructorId: data.instructorId, studentId: data.studentId };
  const conflicts = await detectConflicts(conflictInput);
  if (conflicts.length > 0) {
    if (!data.force) {
      const [suggestions, resources] = await Promise.all([suggestAlternatives(conflictInput), suggestResources(conflictInput)]);
      return NextResponse.json({ conflicts, suggestions, resources }, { status: 409 });
    }
    if (!session.permissions.has("schedule.override_conflicts")) {
      return NextResponse.json({ error: "You don't have permission to override scheduling conflicts." }, { status: 403 });
    }
  }

  // Recurring series: create each future occurrence that is conflict-free;
  // report the ones that were skipped so nothing fails silently.
  const seriesId = data.recurrence ? randomUUID() : null;
  const stepDays = data.recurrence?.freq === "BIWEEKLY" ? 14 : 7;
  const occurrences: { start: Date; end: Date }[] = [{ start, end }];
  if (data.recurrence) {
    for (let i = 1; i < data.recurrence.count; i++) {
      occurrences.push({
        start: new Date(start.getTime() + i * stepDays * 86_400_000),
        end: new Date(end.getTime() + i * stepDays * 86_400_000),
      });
    }
  }

  const skipped: string[] = [];
  type CreatedEvent = Awaited<ReturnType<typeof createOccurrence>>;
  let event: CreatedEvent | null = null;
  const createOccurrence = (occ: { start: Date; end: Date }) =>
    db.scheduleEvent.create({
      data: {
        organizationId,
        seriesId,
        type: data.type,
        start: occ.start,
        end: occ.end,
        aircraftId: data.aircraftId || null,
        instructorId: data.instructorId || null,
        studentId: data.studentId || null,
        lessonTypeId: data.lessonTypeId || null,
        notes: data.notes || null,
      },
      include: eventInclude,
    });
  for (const [i, occ] of occurrences.entries()) {
    if (i > 0) {
      const occConflicts = await detectConflicts({ ...conflictInput, start: occ.start, end: occ.end });
      if (occConflicts.length > 0 && !data.force) {
        skipped.push(occ.start.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
        continue;
      }
    }
    const created = await createOccurrence(occ);
    if (i === 0) event = created;
  }
  if (!event) return NextResponse.json({ error: "Booking could not be created." }, { status: 500 });

  // Notify the student's account about the new booking(s).
  if (event?.student) {
    await db.notification.create({
      data: {
        organizationId,
        userId: (await db.student.findUnique({ where: { id: event.student.id }, select: { userId: true } }))?.userId,
        kind: "UPCOMING_FLIGHT",
        title: seriesId ? `Recurring lessons booked (${occurrences.length - skipped.length}×)` : "New lesson booked",
        body: `${start.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${event.aircraft ? ` · ${event.aircraft.tailNumber}` : ""}`,
      },
    });
  }

  await recordAudit({
    organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: data.force && conflicts.length > 0 ? "schedule.create_override" : "schedule.create",
    entityType: "ScheduleEvent",
    entityId: event.id,
    newValue: { start, end, aircraftId: event.aircraftId, instructorId: event.instructorId, studentId: event.studentId },
  });

  return NextResponse.json({ event, skipped: skipped.length ? skipped : undefined }, { status: 201 });
}
