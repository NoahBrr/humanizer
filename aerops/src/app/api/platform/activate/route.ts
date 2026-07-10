import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { validatePassword } from "@/lib/password";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { hashToken } from "@/lib/tokens";

const schema = z.object({ token: z.string().min(10), password: z.string() });

/** Thrown inside the transaction when a concurrent request already redeemed the
 *  invitation — surfaces a clean 409 rather than a unique-constraint 500. */
class AlreadyAccepted extends Error {}

/**
 * Public, token-authenticated: redeem a Platform User setup token and set the
 * password, creating the account. A new Platform User is NEVER a founder
 * (isFounder is bootstrap-only, ADR-024); the invitation only carries a built-in
 * role. Only the token hash was stored; it is single-use and expiring.
 */
export async function POST(req: Request) {
  const limited = rateLimit(`pu-activate:${clientIp(req)}`, 8, 60_000);
  if (!limited.allowed) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const policy = validatePassword(body.data.password);
  if (!policy.ok) return NextResponse.json({ error: policy.error }, { status: 400 });

  const inv = await db.platformUserInvitation.findUnique({ where: { tokenHash: hashToken(body.data.token) } });
  if (!inv) return NextResponse.json({ error: "This setup link is invalid." }, { status: 404 });
  if (inv.acceptedAt) return NextResponse.json({ error: "This setup link was already used." }, { status: 409 });
  if (inv.expiresAt < new Date()) return NextResponse.json({ error: "This setup link has expired." }, { status: 410 });
  if (await db.platformUser.findUnique({ where: { email: inv.email }, select: { id: true } })) {
    return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(body.data.password, 10);
  let pu;
  try {
    pu = await db.$transaction(async (tx) => {
      // Claim the invitation atomically: only the request that flips acceptedAt
      // null→now proceeds, so a concurrent double-redeem yields a clean 409
      // instead of a unique-constraint 500.
      const claim = await tx.platformUserInvitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
      if (claim.count === 0) throw new AlreadyAccepted();
      return tx.platformUser.create({
        data: {
          email: inv.email,
          passwordHash,
          firstName: inv.firstName,
          lastName: inv.lastName,
          role: inv.role,
          isFounder: false,
          invitedByLabel: inv.invitedByLabel,
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });
    });
  } catch (e) {
    if (e instanceof AlreadyAccepted) return NextResponse.json({ error: "This setup link was already used." }, { status: 409 });
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    throw e;
  }
  await recordAudit({
    actorPlatformUserId: pu.id,
    actorLabel: `${pu.firstName} ${pu.lastName}`,
    action: "platform_user.activated",
    entityType: "PlatformUser",
    entityId: pu.id,
    newValue: { email: pu.email, role: pu.role },
  });
  return NextResponse.json({ ok: true, email: pu.email }, { status: 201 });
}
