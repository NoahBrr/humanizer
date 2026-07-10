import { NextResponse } from "next/server";
import { z } from "zod";
import type { PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { authorizeFounder } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { createToken } from "@/lib/tokens";
import { ASSIGNABLE_PLATFORM_ROLES, canAssignPlatformRoleDirectly } from "@/lib/platform-user-admin";

const PLATFORM_ROLE_VALUES = ASSIGNABLE_PLATFORM_ROLES as [PlatformRole, ...PlatformRole[]];

// Safe summary fields only — never passwordHash, mfaSecret, or tokens.
const SAFE_SELECT = {
  id: true, email: true, firstName: true, lastName: true, role: true, isFounder: true,
  isActive: true, mfaEnabled: true, readOnly: true, restrictedOrgIds: true,
  accessStartsAt: true, accessExpiresAt: true, mustChangePassword: true, createdAt: true,
} as const;

/** Search Platform Users (founder-only). */
export async function GET(req: Request) {
  const { error } = await authorizeFounder();
  if (error) return error;
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const users = await db.platformUser.findMany({
    where: q.length >= 2
      ? { OR: [
          { email: { contains: q, mode: "insensitive" } },
          { firstName: { contains: q, mode: "insensitive" } },
          { lastName: { contains: q, mode: "insensitive" } },
        ] }
      : {},
    select: SAFE_SELECT,
    orderBy: [{ isFounder: "desc" }, { lastName: "asc" }],
    take: 100,
  });
  return NextResponse.json({ users });
}

const createSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  role: z.enum(PLATFORM_ROLE_VALUES),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

/**
 * Invite a new Platform User (founder-only). Creates a single-use setup token
 * (only the hash is stored); the invitee sets their own password on acceptance,
 * so a founder never handles another user's password. FOUNDER_SUPER_ADMIN is not
 * assignable here — founder authority comes only from the bootstrap (ADR-024).
 */
export async function POST(req: Request) {
  const { session, error } = await authorizeFounder({ mutating: true });
  if (error) return error;

  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const data = body.data;

  const roleCheck = canAssignPlatformRoleDirectly(data.role);
  if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.reason }, { status: 400 });

  const email = data.email.toLowerCase();
  if (await db.platformUser.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: "A Platform User with that email already exists." }, { status: 409 });
  }

  const { raw: token, hash: tokenHash } = createToken();
  const inv = await db.platformUserInvitation.create({
    data: {
      email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      tokenHash,
      invitedByLabel: `${session.firstName} ${session.lastName} (Founder)`,
      expiresAt: new Date(Date.now() + data.expiresInDays * 86_400_000),
    },
  });
  await recordAudit({
    actorPlatformUserId: session.userId,
    actorLabel: `${session.firstName} ${session.lastName} (Founder)`,
    action: "founder.platform_user_invite",
    entityType: "PlatformUserInvitation",
    entityId: inv.id,
    newValue: { email, role: data.role },
  });
  return NextResponse.json({ ok: true, setupUrl: `/platform/activate/${token}` }, { status: 201 });
}
