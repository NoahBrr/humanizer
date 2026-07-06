import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { isProfileKey } from "@/lib/business-profiles";
import { AUTOMATIONS } from "@/lib/automations";

const schema = z.object({
  businessProfiles: z.array(z.string()).optional(),
  disabledAutomations: z.array(z.string()).optional(),
});

/** Org owners manage their activated business activities and automations. */
export async function PATCH(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const profiles = body.data.businessProfiles?.filter(isProfileKey);
  const automations = body.data.disabledAutomations?.filter((k) => k in AUTOMATIONS);

  const before = await db.organization.findUnique({
    where: { id: session.organizationId },
    select: { businessProfiles: true, disabledAutomations: true },
  });
  const updated = await db.organization.update({
    where: { id: session.organizationId },
    data: {
      ...(profiles !== undefined ? { businessProfiles: profiles } : {}),
      ...(automations !== undefined ? { disabledAutomations: automations } : {}),
    },
    select: { businessProfiles: true, disabledAutomations: true },
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "org.profiles_change",
    entityType: "Organization",
    entityId: session.organizationId,
    oldValue: before ?? undefined,
    newValue: updated,
  });

  return NextResponse.json({ organization: updated });
}
