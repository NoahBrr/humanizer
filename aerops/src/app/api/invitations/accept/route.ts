import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { validatePassword } from "@/lib/password";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { hashToken } from "@/lib/tokens";
import { assignOwnerTx, addMembershipTx } from "@/lib/memberships";

const acceptSchema = z.object({
  token: z.string().min(10),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  password: z.string(),
});

/** Public endpoint: redeem an invitation token and create the account. */
export async function POST(req: Request) {
  const limited = rateLimit(`invite-accept:${clientIp(req)}`, 8, 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  const body = acceptSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  const data = body.data;
  const policy = validatePassword(data.password);
  if (!policy.ok) return NextResponse.json({ error: policy.error }, { status: 400 });

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(data.token) },
    include: { organization: { include: { plan: true, _count: { select: { users: true } } } } },
  });
  // A proposed Account Owner activates ownership on acceptance, but only if the
  // org is still ownerless — never clobber an existing owner (Part 8).
  const asOwner = invitation ? invitation.role === "ACCOUNT_OWNER" && !invitation.organization.ownerId : false;
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
  // Non-owner role for the account/profile; ownership (if any) is conferred by
  // the membership service, which also creates the ACCOUNT_OWNER membership and
  // projects the active org. Account + membership + acceptance are one tx so an
  // accepted invitation never leaves a half-provisioned or ownerless member.
  const effectiveRole = invitation.role === "ACCOUNT_OWNER" ? "SCHOOL_ADMIN" : invitation.role;
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invitation.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: effectiveRole,
        customRoleId: invitation.customRoleId,
        // Role-appropriate profile so the user is functional immediately.
        ...(effectiveRole === "STUDENT" ? { studentProfile: { create: {} } } : {}),
        ...(effectiveRole === "INSTRUCTOR" ? { instructorProfile: { create: { certificates: "CFI" } } } : {}),
      },
    });
    if (asOwner) {
      await assignOwnerTx(tx, { organizationId: invitation.organizationId, userId: created.id, invitedByLabel: invitation.invitedBy ?? undefined });
    } else {
      await addMembershipTx(tx, {
        userId: created.id,
        organizationId: invitation.organizationId,
        role: effectiveRole,
        customRoleId: invitation.customRoleId,
        invitedByLabel: invitation.invitedBy ?? undefined,
      });
    }
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    return created;
  });

  await recordAudit({
    organizationId: invitation.organizationId,
    actorUserId: user.id,
    actorLabel: `${user.firstName} ${user.lastName}`,
    action: "users.invitation_accepted",
    entityType: "User",
    entityId: user.id,
    newValue: { email: user.email, role: asOwner ? "ACCOUNT_OWNER" : effectiveRole, owner: asOwner },
  });
  logger.info("invitation accepted", { organizationId: invitation.organizationId, role: invitation.role });

  return NextResponse.json({ ok: true, email: user.email }, { status: 201 });
}
