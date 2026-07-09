import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize, getSession } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { approveJoinRequest, JOINABLE_ROLES } from "@/lib/onboarding";

const adminSchema = z.object({
  action: z.enum(["approve", "reject", "more_info"]),
  role: z.enum(JOINABLE_ROLES as [string, ...string[]]).optional(),
  locationId: z.string().optional(),
  adminNote: z.string().max(500).optional(),
  adminResponse: z.string().max(1000).optional(),
});

/** Admin decision on a join request (approve / reject / ask for more info). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, error } = await authorize("users.manage", { mutating: true });
  if (error) return error;
  const { id } = await params;

  const body = adminSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const request = await db.joinRequest.findFirst({
    where: { id, organizationId: session.organizationId },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
  });
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (request.status === "APPROVED" || request.status === "CANCELLED") {
    return NextResponse.json({ error: "This request has already been finalized." }, { status: 409 });
  }

  const actorLabel = `${session.firstName} ${session.lastName}`;

  if (body.data.action === "approve") {
    const result = await approveJoinRequest(id, actorLabel, {
      role: body.data.role as (typeof JOINABLE_ROLES)[number] | undefined,
      locationId: body.data.locationId,
      adminNote: body.data.adminNote,
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    await recordAudit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      actorLabel,
      action: "join_request.approve",
      entityType: "JoinRequest",
      entityId: id,
      newValue: { user: request.user.email, role: result.role },
    });
    return NextResponse.json({ ok: true, status: "APPROVED" });
  }

  const status = body.data.action === "reject" ? "REJECTED" : "MORE_INFO";
  await db.joinRequest.update({
    where: { id },
    data: {
      status,
      adminNote: body.data.adminNote,
      adminResponse: body.data.adminResponse,
      decidedByLabel: actorLabel,
      decidedAt: new Date(),
    },
  });
  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel,
    action: `join_request.${body.data.action}`,
    entityType: "JoinRequest",
    entityId: id,
    newValue: { user: request.user.email, response: body.data.adminResponse ?? null },
  });
  return NextResponse.json({ ok: true, status });
}

/**
 * Requester cancels their own pending request. Session-gated self-service:
 * individual accounts act only on rows where userId is their own.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const request = await db.joinRequest.findFirst({ where: { id, userId: session.userId, status: { in: ["PENDING", "MORE_INFO"] } } });
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  await db.joinRequest.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
