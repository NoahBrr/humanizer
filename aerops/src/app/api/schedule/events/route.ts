import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { detectConflicts, suggestAlternatives } from "@/lib/scheduling";

const eventInclude = {
  aircraft: { select: { id: true, tailNumber: true } },
  instructor: { include: { user: { select: { firstName: true, lastName: true } } } },
  student: { include: { user: { select: { firstName: true, lastName: true } } } },
  lessonType: { select: { id: true, name: true, color: true } },
} as const;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  const events = await db.scheduleEvent.findMany({
    where: {
      organizationId: session.user.organizationId,
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
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "STUDENT" || session.user.role === "MAINTENANCE" || session.user.role === "ACCOUNTANT") {
    return NextResponse.json({ error: "Your role cannot create bookings" }, { status: 403 });
  }

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;
  const organizationId = session.user.organizationId;
  const start = new Date(data.start);
  const end = new Date(data.end);

  if (end <= start) return NextResponse.json({ error: "End must be after start" }, { status: 400 });

  const conflictInput = { organizationId, start, end, aircraftId: data.aircraftId, instructorId: data.instructorId, studentId: data.studentId };
  const conflicts = await detectConflicts(conflictInput);
  if (conflicts.length > 0 && !data.force) {
    const suggestions = await suggestAlternatives(conflictInput);
    return NextResponse.json({ conflicts, suggestions }, { status: 409 });
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

  return NextResponse.json({ event }, { status: 201 });
}
