import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

const joinSchema = z.object({ date: z.string().datetime(), notes: z.string().max(300).nullish() });

/** Join the waitlist for a day; cancellations on that day trigger notifications. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.impersonation?.readOnly) return NextResponse.json({ error: "Read-only session" }, { status: 403 });

  const student = await db.student.findFirst({ where: { userId: session.userId } });
  if (!student) return NextResponse.json({ error: "Only students can join the waitlist." }, { status: 403 });

  const body = joinSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const date = new Date(body.data.date);
  date.setHours(0, 0, 0, 0);

  const entry = await db.waitlistEntry.create({
    data: { organizationId: session.organizationId, studentId: student.id, date, notes: body.data.notes ?? null },
  });
  return NextResponse.json({ entry }, { status: 201 });
}
