import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const baseSchema = z.object({
  name: z.string().trim().min(1, "Lesson type name is required").max(120, "Lesson type name must be 120 characters or fewer"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex value like #2563eb"),
  durationMin: z.number().int("Duration must be a whole number of minutes").min(15, "Minimum lesson length is 15 minutes").max(480, "Maximum lesson length is 480 minutes"),
  requiresAircraft: z.boolean().default(true),
  requiresInstructor: z.boolean().default(true),
});
const createSchema = baseSchema;
const updateSchema = baseSchema.extend({ id: z.string().min(1, "Lesson type id is required") });

const SELECT = { id: true, name: true, color: true, durationMin: true, requiresAircraft: true, requiresInstructor: true } as const;

/** Create a lesson type for the caller's organization. */
export async function POST(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const created = await db.lessonType.create({
    data: { organizationId: session.organizationId, ...body.data },
    select: SELECT,
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "lesson_type.create",
    entityType: "LessonType",
    entityId: created.id,
    newValue: created,
  });

  return NextResponse.json({ lessonType: created });
}

/** Update a lesson type the caller's organization owns. */
export async function PATCH(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = updateSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const { id, ...data } = body.data;
  // Tenant guard: the row must belong to the caller's org before we touch it.
  const before = await db.lessonType.findUnique({ where: { id }, select: { ...SELECT, organizationId: true } });
  if (!before || before.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Lesson type not found." }, { status: 404 });
  }

  const updated = await db.lessonType.update({ where: { id }, data, select: SELECT });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "lesson_type.update",
    entityType: "LessonType",
    entityId: updated.id,
    oldValue: {
      name: before.name, color: before.color, durationMin: before.durationMin,
      requiresAircraft: before.requiresAircraft, requiresInstructor: before.requiresInstructor,
    },
    newValue: updated,
  });

  return NextResponse.json({ lessonType: updated });
}
