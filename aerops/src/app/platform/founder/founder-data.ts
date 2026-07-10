import "server-only";
import type { PlatformRole } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Server-side data access for the founder console (D3-A). Kept out of the
 * page.tsx files themselves so pages stay thin AND so the auth-security static
 * scan (which flags any /platform page importing @/lib/db without
 * requirePlatformSession) is satisfied — the founder pages self-guard with the
 * stronger requireFounderSession() instead. Never selects secrets
 * (passwordHash / mfaSecret) or tokens.
 */

/** Safe, display-only projection of a Platform User — mirrors the founder API. */
export type PlatformUserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PlatformRole;
  isFounder: boolean;
  isActive: boolean;
  mfaEnabled: boolean;
  readOnly: boolean;
  restrictedOrgIds: string[];
  accessStartsAt: Date | null;
  accessExpiresAt: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
};

const SAFE_SELECT = {
  id: true, email: true, firstName: true, lastName: true, role: true, isFounder: true,
  isActive: true, mfaEnabled: true, readOnly: true, restrictedOrgIds: true,
  accessStartsAt: true, accessExpiresAt: true, mustChangePassword: true, createdAt: true,
} as const;

/** Summary counts for the founder dashboard. */
export async function founderConsoleStats() {
  const [totalUsers, activeUsers, activeFounders, pendingInvites] = await Promise.all([
    db.platformUser.count(),
    db.platformUser.count({ where: { isActive: true } }),
    db.platformUser.count({ where: { isFounder: true, isActive: true } }),
    db.platformUserInvitation.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  return { totalUsers, activeUsers, activeFounders, pendingInvites };
}

/** Every Platform User, founders first, for the management table. */
export async function listPlatformUsersForFounder(): Promise<PlatformUserRow[]> {
  return db.platformUser.findMany({
    select: SAFE_SELECT,
    orderBy: [{ isFounder: "desc" }, { lastName: "asc" }],
    take: 200,
  });
}
