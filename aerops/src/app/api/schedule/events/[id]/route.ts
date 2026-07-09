import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { emitDomainEvent } from "@/lib/events";
import { detectConflicts, suggestAlternatives, suggestResources } from "@/lib/scheduling";

const patchSchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  status: z.enum(["SCHEDULED", "DISPATCHED", "IN_FLIGHT", "COMPLETED", "CANCELLED", "NO_SHOW", "WEATHER_CANCELLED"]).optional(),
  cancellationReason: z.string().nullish(),
  notes: z.string().nullish(),
  force: z.boolean().default(false),
  /// "series" applies a cancellation to this and all future events in the series.
  scope: z.enum(["single", "series"]).default("single"),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("schedule.edit", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const existing = await db.scheduleEvent.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  // Re-run conflict detection when the window moves
  if (data.start || data.end) {
    const start = data.start ? new Date(data.start) : existing.start;
    const end = data.end ? new Date(data.end) : existing.end;
    if (end <= start) return NextResponse.json({ error: "End must be after start" }, { status: 400 });

    const conflictInput = {
      organizationId: existing.organizationId,
      start,
      end,
      aircraftId: existing.aircraftId,
      instructorId: existing.instructorId,
      studentId: existing.studentId,
      excludeEventId: existing.id,
    };
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
  }

  const event = await db.scheduleEvent.update({
    where: { id },
    data: {
      ...(data.start ? { start: new Date(data.start) } : {}),
      ...(data.end ? { end: new Date(data.end) } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.cancellationReason !== undefined ? { cancellationReason: data.cancellationReason } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
  });

  // Series-wide cancellation: apply to every future occurrence too.
  if (data.scope === "series" && existing.seriesId && data.status && ["CANCELLED", "WEATHER_CANCELLED"].includes(data.status)) {
    await db.scheduleEvent.updateMany({
      where: { seriesId: existing.seriesId, organizationId: existing.organizationId, start: { gt: existing.start }, status: "SCHEDULED" },
      data: { status: data.status, cancellationReason: data.cancellationReason ?? "Series cancelled" },
    });
  }

  // Cancellations free a slot: tell the student, then invite the waitlist.
  const cancelled = ["CANCELLED", "WEATHER_CANCELLED"].includes(data.status ?? "") && existing.status !== data.status;
  if (cancelled) {
    if (existing.studentId) {
      const st = await db.student.findUnique({ where: { id: existing.studentId }, select: { userId: true } });
      await db.notification.create({
        data: {
          organizationId: existing.organizationId,
          userId: st?.userId,
          kind: data.status === "WEATHER_CANCELLED" ? "WEATHER_CANCELLATION" : "SCHEDULE_CHANGE",
          title: data.status === "WEATHER_CANCELLED" ? "Lesson cancelled for weather" : "Lesson cancelled",
          body: `${existing.start.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${data.cancellationReason ? ` — ${data.cancellationReason}` : ""}`,
        },
      });
    }
    const dayStart = new Date(existing.start); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const waitlisted = await db.waitlistEntry.findMany({
      where: { organizationId: existing.organizationId, date: { gte: dayStart, lt: dayEnd }, notifiedAt: null },
      include: { student: { select: { userId: true, user: { select: { firstName: true } } } } },
      take: 5,
    });
    for (const w of waitlisted) {
      await db.notification.create({
        data: {
          organizationId: existing.organizationId,
          userId: w.student.userId,
          kind: "SCHEDULE_CHANGE",
          title: "A slot just opened up",
          body: `${existing.start.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} became available — you're on the waitlist for that day. Request it before it's gone.`,
        },
      });
      await db.waitlistEntry.update({ where: { id: w.id }, data: { notifiedAt: new Date() } });
    }
    await emitDomainEvent(existing.organizationId, "schedule.cancelled", {
      eventId: existing.id, start: existing.start.toISOString(), reason: data.cancellationReason ?? null, weather: data.status === "WEATHER_CANCELLED",
    });
  }

  await recordAudit({
    organizationId: existing.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "schedule.update",
    entityType: "ScheduleEvent",
    entityId: id,
    oldValue: { start: existing.start, end: existing.end, status: existing.status },
    newValue: { start: event.start, end: event.end, status: event.status },
  });

  return NextResponse.json({ event });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("schedule.delete", { mutating: true });
  if (error) return error;

  const { id } = await params;
  const existing = await db.scheduleEvent.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.scheduleEvent.delete({ where: { id } });
  await recordAudit({
    organizationId: existing.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "schedule.delete",
    entityType: "ScheduleEvent",
    entityId: id,
    oldValue: { start: existing.start, end: existing.end, status: existing.status },
  });
  return NextResponse.json({ ok: true });
}
