import "server-only";
import type { PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";

/**
 * Look up a Platform User invitation by its raw setup token (D3-A). Only the
 * token hash is stored, so we hash the presented value and match. Returns a
 * status plus display-only fields — never the token hash or any secret. Kept
 * out of the page.tsx so the public activation page holds no @/lib/db import
 * (it must NOT require a session, so it cannot call requirePlatformSession).
 */
export type InvitationLookup =
  | { status: "valid"; invite: { email: string; firstName: string; lastName: string; role: PlatformRole } }
  | { status: "invalid" | "used" | "expired" };

export async function getPlatformInvitationByToken(token: string): Promise<InvitationLookup> {
  const inv = await db.platformUserInvitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { email: true, firstName: true, lastName: true, role: true, acceptedAt: true, expiresAt: true },
  });
  if (!inv) return { status: "invalid" };
  if (inv.acceptedAt) return { status: "used" };
  if (inv.expiresAt < new Date()) return { status: "expired" };
  return { status: "valid", invite: { email: inv.email, firstName: inv.firstName, lastName: inv.lastName, role: inv.role } };
}
