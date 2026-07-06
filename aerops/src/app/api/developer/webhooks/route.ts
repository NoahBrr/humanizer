import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";

const createSchema = z.object({
  url: z.string().url().max(300),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

/** Register a webhook endpoint. The signing secret is returned once. */
export async function POST(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Provide a valid HTTPS URL and at least one event." }, { status: 400 });

  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const hook = await db.webhook.create({
    data: { organizationId: session.organizationId, url: body.data.url, events: body.data.events, secret },
  });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "developer.webhook_created",
    entityType: "Webhook",
    entityId: hook.id,
    newValue: { url: hook.url, events: hook.events },
  });
  return NextResponse.json({ id: hook.id, secret }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { session, error } = await authorize("settings.manage", { mutating: true });
  if (error) return error;
  const { id } = z.object({ id: z.string() }).parse(await req.json());
  const hook = await db.webhook.findFirst({ where: { id, organizationId: session.organizationId } });
  if (!hook) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.webhook.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
