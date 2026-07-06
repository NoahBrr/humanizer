import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { authorize } from "@/lib/session";
import { recordAudit } from "@/lib/audit";

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(["SCHOOL_ADMIN", "DISPATCHER", "INSTRUCTOR", "STUDENT", "MAINTENANCE", "ACCOUNTANT"]),
  customRoleId: z.string().nullish(),
  expiresInDays: z.number().int().min(1).max(60).default(14),
});

export async function POST(req: Request) {
  const { session, error } = await authorize("users.manage", { mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;
  const email = data.email.toLowerCase();

  if (await db.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
  }

  // Enforce the subscription's seat limit (pending invitations count as seats).
  const org = await db.organization.findUnique({
    where: { id: session.organizationId },
    include: { plan: true, _count: { select: { users: true, invitations: { where: { acceptedAt: null, expiresAt: { gt: new Date() } } } } } },
  });
  if (org?.plan && org._count.users + org._count.invitations >= org.plan.maxUsers) {
    return NextResponse.json(
      { error: `Your ${org.plan.name} plan allows ${org.plan.maxUsers} users. Upgrade the plan to invite more.` },
      { status: 402 },
    );
  }

  const token = randomBytes(24).toString("base64url");
  const invitation = await db.invitation.create({
    data: {
      organizationId: session.organizationId,
      email,
      role: data.role,
      customRoleId: data.customRoleId ?? null,
      token,
      invitedBy: `${session.firstName} ${session.lastName}`,
      expiresAt: new Date(Date.now() + data.expiresInDays * 86_400_000),
    },
  });

  await recordAudit({
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName}`,
    action: "users.invite",
    entityType: "Invitation",
    entityId: invitation.id,
    newValue: { email, role: data.role },
  });

  // Email delivery is a SendGrid adapter in production; the link is returned
  // so admins can hand it over directly meanwhile.
  return NextResponse.json({ invitation: { id: invitation.id, email, role: data.role, expiresAt: invitation.expiresAt }, inviteUrl: `/invite/${token}` }, { status: 201 });
}
