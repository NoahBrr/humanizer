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
export function platformClaimsValid<T extends { isActive: boolean; sessionVersion: number }>(
  dbUser: T | null,
  tokenSessionVersion: number | undefined,
): dbUser is T {
  if (!dbUser || !dbUser.isActive) return false;
  if (tokenSessionVersion === undefined) return false;
  return dbUser.sessionVersion === tokenSessionVersion;
}

/**
 * Whether a resolved session is allowed into the /platform console. Only
 * AeroOps staff (a `platformRole` on the session) qualify — an org member,
 * an org admin, a student, or an individual account never does. Wired into
 * requirePlatformSession()/authorizePlatform() so the boundary lives in one
 * place and is provable without a database (tests/auth-security.test.ts).
 */
export function platformAccessAllowed<T extends { platformRole?: unknown }>(
  session: T | null | undefined,
): session is T & { platformRole: NonNullable<T["platformRole"]> } {
  return !!session?.platformRole;
}
