import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { detectConflicts, suggestAlternatives } from "@/lib/scheduling";

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

  const conflictInput = { organizationId, start, end, aircraftId: data.aircraftId, instructorId: data.instructorId, studentId: data.studentId };
  const conflicts = await detectConflicts(conflictInput);
  if (conflicts.length > 0) {
    if (!data.force) {
      const suggestions = await suggestAlternatives(conflictInput);
      return NextResponse.json({ conflicts, suggestions }, { status: 409 });
    }
    if (!session.permissions.has("schedule.override_conflicts")) {
      return NextResponse.json({ error: "You don't have permission to override scheduling conflicts." }, { status: 403 });
    }
  }

  const event = await db.scheduleEvent.create({
    data: {
      organizationId,
      type: data.type,
      start,
      end,
      aircraftId: data.aircraftId || null,
      instructorId: data.instructorId || null,
      studentId: data.studentId || null,
      lessonTypeId: data.lessonTypeId || null,
      notes: data.notes || null,
    },
    include: eventInclude,
  });

  await recordAudit({
    organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: data.force && conflicts.length > 0 ? "schedule.create_override" : "schedule.create",
    entityType: "ScheduleEvent",
    entityId: event.id,
    newValue: { start, end, aircraftId: event.aircraftId, instructorId: event.instructorId, studentId: event.studentId },
  });

  return NextResponse.json({ event }, { status: 201 });
}
