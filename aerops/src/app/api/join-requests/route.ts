import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { JOINABLE_ROLES } from "@/lib/onboarding";

const schema = z.object({
  organizationId: z.string().min(1),
  requestedRole: z.enum(JOINABLE_ROLES as [string, ...string[]]).default("STUDENT"),
  phone: z.string().max(30).optional(),
  certificateInfo: z.string().max(200).optional(),
  reason: z.string().max(500).optional(),
  message: z.string().max(1000).optional(),
});

/**
 * File a request to join an organization. Session-gated self-service: the
 * caller is an INDIVIDUAL account acting on their own membership — org
 * permissions cannot apply because they have no org yet. Admins review at
 * /settings/join-requests.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.kind !== "individual") {
    return NextResponse.json({ error: "You already belong to an organization." }, { status: 400 });
  }
  const limited = rateLimit(`join-req:${clientIp(req)}`, 10, 3_600_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });

  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });

  const org = await db.organization.findUnique({ where: { id: body.data.organizationId }, select: { id: true, name: true, status: true, deletedAt: true } });
  if (!org || org.status !== "ACTIVE" || org.deletedAt) {
    return NextResponse.json({ error: "That organization is not accepting requests." }, { status: 404 });
  }

  const existing = await db.joinRequest.findFirst({
    where: { userId: session.userId, organizationId: org.id, status: { in: ["PENDING", "MORE_INFO"] } },
  });
  if (existing) return NextResponse.json({ error: "You already have an open request with this organization." }, { status: 409 });

  const request = await db.joinRequest.create({
    data: {
      organizationId: org.id,
      userId: session.userId,
      requestedRole: body.data.requestedRole as (typeof JOINABLE_ROLES)[number],
      phone: body.data.phone,
      certificateInfo: body.data.certificateInfo,
      reason: body.data.reason,
      message: body.data.message,
    },
  });

  // Surface it to org admins in-app.
  await db.notification.create({
    data: {
      organizationId: org.id,
      kind: "GENERAL",
      title: `Join request from ${session.firstName} ${session.lastName}`,
      body: `Requested role: ${body.data.requestedRole.toLowerCase().replaceAll("_", " ")}. Review in Settings → Join Requests.`,
    },
  });

  return NextResponse.json({ ok: true, requestId: request.id }, { status: 201 });
}
