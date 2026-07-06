import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { detectConflicts, suggestAlternatives } from "@/lib/scheduling";

const patchSchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
  status: z.enum(["SCHEDULED", "DISPATCHED", "IN_FLIGHT", "COMPLETED", "CANCELLED", "NO_SHOW", "WEATHER_CANCELLED"]).optional(),
  cancellationReason: z.string().nullish(),
  notes: z.string().nullish(),
  force: z.boolean().default(false),
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
        const suggestions = await suggestAlternatives(conflictInput);
        return NextResponse.json({ conflicts, suggestions }, { status: 409 });
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
