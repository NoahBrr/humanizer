/**
 * Pure session-revocation rules, kept import-free so the test suite can
 * exercise them directly (src/lib/session.ts pulls in server-only modules).
 */

/**
 * Platform-session revocation check, mirroring the org-user rule in
 * orgSessionFor(). Fails closed: a missing row, a deactivated account, or
 * any sessionVersion drift — including a token with no version claim —
 * kills the session immediately.
 */
export function platformClaimsValid(
  dbUser: { isActive: boolean; sessionVersion: number } | null,
  tokenSessionVersion: number | undefined,
): boolean {
  if (!dbUser || !dbUser.isActive) return false;
  if (tokenSessionVersion === undefined) return false;
  return dbUser.sessionVersion === tokenSessionVersion;
}
