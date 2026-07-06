import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";

const acceptSchema = z.object({
  token: z.string().min(10),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/** Public endpoint: redeem an invitation token and create the account. */
export async function POST(req: Request) {
  const body = acceptSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const data = body.data;

  const invitation = await db.invitation.findUnique({
    where: { token: data.token },
    include: { organization: { include: { plan: true, _count: { select: { users: true } } } } },
  });
  if (!invitation) return NextResponse.json({ error: "This invitation link is invalid." }, { status: 404 });
  if (invitation.acceptedAt) return NextResponse.json({ error: "This invitation was already used. Try signing in instead." }, { status: 409 });
  if (invitation.expiresAt < new Date()) return NextResponse.json({ error: "This invitation has expired. Ask your administrator for a new one." }, { status: 410 });
  if (invitation.organization.status !== "ACTIVE") return NextResponse.json({ error: "This organization is not active." }, { status: 403 });
  if (await db.user.findUnique({ where: { email: invitation.email } })) {
    return NextResponse.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });
  }
  if (invitation.organization.plan && invitation.organization._count.users >= invitation.organization.plan.maxUsers) {
    return NextResponse.json({ error: "The organization has reached its plan's user limit. Contact your administrator." }, { status: 402 });
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await db.user.create({
    data: {
      organizationId: invitation.organizationId,
      email: invitation.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      role: invitation.role,
      customRoleId: invitation.customRoleId,
      // Role-appropriate profile so the user is functional immediately.
      ...(invitation.role === "STUDENT" ? { studentProfile: { create: {} } } : {}),
      ...(invitation.role === "INSTRUCTOR" ? { instructorProfile: { create: { certificates: "CFI" } } } : {}),
    },
  });
  await db.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });

  await recordAudit({
    organizationId: invitation.organizationId,
    actorUserId: user.id,
    actorLabel: `${user.firstName} ${user.lastName}`,
    action: "users.invitation_accepted",
    entityType: "User",
    entityId: user.id,
    newValue: { email: user.email, role: user.role },
  });
  logger.info("invitation accepted", { organizationId: invitation.organizationId, role: invitation.role });

  return NextResponse.json({ ok: true, email: user.email }, { status: 201 });
}
