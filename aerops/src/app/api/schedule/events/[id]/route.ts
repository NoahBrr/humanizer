import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
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
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await db.scheduleEvent.findFirst({ where: { id, organizationId: session.user.organizationId } });
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
    if (conflicts.length > 0 && !data.force) {
      const suggestions = await suggestAlternatives(conflictInput);
      return NextResponse.json({ conflicts, suggestions }, { status: 409 });
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

  return NextResponse.json({ event });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await db.scheduleEvent.findFirst({ where: { id, organizationId: session.user.organizationId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.scheduleEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
