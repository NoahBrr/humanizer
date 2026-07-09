import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { createToken } from "@/lib/tokens";
import { JOINABLE_ROLES } from "@/lib/onboarding";

const createSchema = z.object({
  label: z.string().min(2).max(60),
  role: z.enum(JOINABLE_ROLES as [string, ...string[]]).default("STUDENT"),
  autoApprove: z.boolean().default(false),
  maxUses: z.number().int().min(1).max(10_000).nullish(),
  expiresInDays: z.number().int().min(1).max(365).nullish(),
});

/** Create a shareable invite link for the organization. */
export async function POST(req: Request) {
  const { session, error } = await authorize("users.manage", { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  // Store only the hash; the raw token is returned once for the admin to copy.
  const { raw: token, hash: tokenHash } = createToken();
  const link = await db.inviteLink.create({
    data: {
      organizationId: session.organizationId,
      tokenHash,
      label: body.data.label,
      role: body.data.role as (typeof JOINABLE_ROLES)[number],
      autoApprove: body.data.autoApprove,
      maxUses: body.data.maxUses ?? null,
      expiresAt: body.data.expiresInDays ? new Date(Date.now() + body.data.expiresInDays * 86_400_000) : null,
      createdBy: `${session.firstName} ${session.lastName}`,
    },
  });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "invite_link.create",
    entityType: "InviteLink",
    entityId: link.id,
    newValue: { label: link.label, role: link.role, autoApprove: link.autoApprove },
  });
  // The raw token is shown exactly once — it is not recoverable from storage.
  return NextResponse.json({ ok: true, link: { id: link.id, url: `/join/${token}` } }, { status: 201 });
}

const revokeSchema = z.object({ id: z.string().min(1) });

/** Revoke an invite link. */
export async function DELETE(req: Request) {
  const { session, error } = await authorize("users.manage", { mutating: true });
  if (error) return error;

  const body = revokeSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const link = await db.inviteLink.findFirst({ where: { id: body.data.id, organizationId: session.organizationId } });
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.inviteLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "invite_link.revoke",
    entityType: "InviteLink",
    entityId: link.id,
    oldValue: { label: link.label },
  });
  return NextResponse.json({ ok: true });
}
