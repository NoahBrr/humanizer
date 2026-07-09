import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { isValidTimeZone } from "@/lib/timezones";

const baseSchema = z.object({
  name: z.string().trim().min(1, "Location name is required").max(120, "Location name must be 120 characters or fewer"),
  icao: z.string().trim().max(8, "ICAO codes are at most 8 characters").nullish(),
  timeZone: z.string().refine(isValidTimeZone, "Choose a time zone from the supported list"),
  isActive: z.boolean().default(true),
});
const createSchema = baseSchema;
const updateSchema = baseSchema.extend({ id: z.string().min(1, "Location id is required") });

const SELECT = { id: true, name: true, icao: true, timeZone: true, isActive: true } as const;

/** ICAO is stored uppercase; blank clears it to null. */
function normalizeIcao(icao: string | null | undefined): string | null {
  return icao ? icao.toUpperCase() : null;
}

/** Create a location for the caller's organization. */
export async function POST(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const created = await db.location.create({
    data: {
      organizationId: session.organizationId,
      name: body.data.name,
      icao: normalizeIcao(body.data.icao),
      timeZone: body.data.timeZone,
      isActive: body.data.isActive,
    },
    select: SELECT,
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "location.create",
    entityType: "Location",
    entityId: created.id,
    newValue: created,
  });

  return NextResponse.json({ location: created });
}

/** Update a location the caller's organization owns. */
export async function PATCH(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = updateSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  // Tenant guard: the row must belong to the caller's org before we touch it.
  const before = await db.location.findUnique({ where: { id: body.data.id }, select: { ...SELECT, organizationId: true } });
  if (!before || before.organizationId !== session.organizationId) {
    return NextResponse.json({ error: "Location not found." }, { status: 404 });
  }

  const updated = await db.location.update({
    where: { id: body.data.id },
    data: {
      name: body.data.name,
      icao: normalizeIcao(body.data.icao),
      timeZone: body.data.timeZone,
      isActive: body.data.isActive,
    },
    select: SELECT,
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "location.update",
    entityType: "Location",
    entityId: updated.id,
    oldValue: { name: before.name, icao: before.icao, timeZone: before.timeZone, isActive: before.isActive },
    newValue: updated,
  });

  return NextResponse.json({ location: updated });
}
