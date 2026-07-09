import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { isValidTimeZone } from "@/lib/timezones";

const schema = z.object({
  name: z.string().trim().min(1, "School name is required").max(120, "School name must be 120 characters or fewer"),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Brand color must be a 6-digit hex value like #2563eb"),
  timeZone: z.string().refine(isValidTimeZone, "Choose a time zone from the supported list"),
});

/**
 * Update org identity: display name, brand color, and time zone. Slug is
 * intentionally NOT editable here — it anchors the sign-in URL and shared
 * links, so it is changed only through support.
 */
export async function PATCH(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const before = await db.organization.findUnique({
    where: { id: session.organizationId },
    select: { name: true, brandColor: true, timeZone: true },
  });
  const updated = await db.organization.update({
    where: { id: session.organizationId },
    data: { name: body.data.name, brandColor: body.data.brandColor, timeZone: body.data.timeZone },
    select: { name: true, slug: true, brandColor: true, timeZone: true },
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "org.settings_change",
    entityType: "Organization",
    entityId: session.organizationId,
    oldValue: before ?? undefined,
    newValue: updated,
  });

  return NextResponse.json({ organization: updated });
}
