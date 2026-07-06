import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, getSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const createSchema = z.object({
  preferredStart: z.string().datetime(),
  durationMin: z.number().int().min(30).max(480).default(120),
  lessonTypeId: z.string().nullish(),
  instructorId: z.string().nullish(),
  notes: z.string().max(500).nullish(),
});

/** Students request lessons; staff review them on the schedule page. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !session.permissions.has("schedule.view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.impersonation?.readOnly) return NextResponse.json({ error: "Read-only session" }, { status: 403 });

  const student = await db.student.findFirst({ where: { userId: session.userId } });
  if (!student) return NextResponse.json({ error: "Only students can request lessons." }, { status: 403 });

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const request = await db.lessonRequest.create({
    data: {
      organizationId: session.organizationId,
      studentId: student.id,
      preferredStart: new Date(body.data.preferredStart),
      durationMin: body.data.durationMin,
      lessonTypeId: body.data.lessonTypeId ?? null,
      instructorId: body.data.instructorId ?? null,
      notes: body.data.notes ?? null,
    },
  });

  // Dispatch sees a new request in the org feed.
  await db.notification.create({
    data: {
      organizationId: session.organizationId,
      kind: "SCHEDULE_CHANGE",
      title: "New lesson request",
      body: `${session.firstName} ${session.lastName} requested ${new Date(body.data.preferredStart).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
    },
  });

  return NextResponse.json({ request }, { status: 201 });
}

const patchSchema = z.object({
  id: z.string(),
  status: z.enum(["APPROVED", "REJECTED", "NEEDS_CHANGES", "SCHEDULED", "CANCELLED"]),
  staffNote: z.string().max(500).nullish(),
});

/** Staff review: approve/reject/mark scheduled; the student is notified. */
export async function PATCH(req: Request) {
  const { session, error } = await authorize("schedule.create", { mutating: true });
  if (error) return error;

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const existing = await db.lessonRequest.findFirst({
    where: { id: body.data.id, organizationId: session.organizationId },
    include: { student: { select: { userId: true } } },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const request = await db.lessonRequest.update({
    where: { id: existing.id },
    data: { status: body.data.status, staffNote: body.data.staffNote ?? existing.staffNote },
  });

  await db.notification.create({
    data: {
      organizationId: session.organizationId,
      userId: existing.student.userId,
      kind: "SCHEDULE_CHANGE",
      title: `Lesson request ${body.data.status.replaceAll("_", " ").toLowerCase()}`,
      body: body.data.staffNote ?? undefined,
    },
  });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: `schedule.request_${body.data.status.toLowerCase()}`,
    entityType: "LessonRequest",
    entityId: existing.id,
  });

  return NextResponse.json({ request });
}
