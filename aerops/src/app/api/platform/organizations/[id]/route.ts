import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorizePlatform } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const patchSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional(),
  planId: z.string().optional(),
  disabledModules: z.array(z.string()).optional(),
});

/** Suspend/reactivate/soft-delete an org, change its plan, or toggle modules. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorizePlatform(["FOUNDER", "PLATFORM_ADMIN", "BILLING_ADMIN"]);
  if (error) return error;

  const { id } = await params;
  const org = await db.organization.findUnique({ where: { id } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  const updated = await db.organization.update({
    where: { id },
    data: {
      ...(data.status
        ? {
            status: data.status,
            suspendedAt: data.status === "SUSPENDED" ? new Date() : null,
            deletedAt: data.status === "DELETED" ? new Date() : null,
          }
        : {}),
      ...(data.planId ? { planId: data.planId } : {}),
      ...(data.disabledModules ? { disabledModules: data.disabledModules } : {}),
    },
  });

  await recordAudit({
    organizationId: id,
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName} (AeroOps)`,
    action: data.status ? `platform.org_${data.status.toLowerCase()}` : data.planId ? "platform.org_plan_change" : "platform.org_modules_change",
    entityType: "Organization",
    entityId: id,
    oldValue: { status: org.status, planId: org.planId, disabledModules: org.disabledModules },
    newValue: { status: updated.status, planId: updated.planId, disabledModules: updated.disabledModules },
  });

  return NextResponse.json({ organization: updated });
}
