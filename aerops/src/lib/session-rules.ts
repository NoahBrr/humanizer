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

/**
 * Whether a resolved session holds founder authority (D3-A / ADR-024). Keys on
 * the immutable `isFounder` identity — set only by the founder bootstrap, never
 * granted by a role — so founder-exclusive surfaces cannot be reached by editing
 * a platform role. Enforced server-side by authorizeFounder()/requireFounder().
 */
export function founderAccessAllowed<T extends { isFounder?: boolean }>(
  session: T | null | undefined,
): boolean {
  return session?.isFounder === true;
}

/**
 * Whether a platform user's time-boxed access window is currently open. Access
 * before `accessStartsAt` or after `accessExpiresAt` is refused, so temporary or
 * scheduled platform access expires on its own. Null bounds mean "no bound".
 */
export function platformAccessWindowActive(
  dbUser: { accessStartsAt?: Date | null; accessExpiresAt?: Date | null },
  now: Date,
): boolean {
  if (dbUser.accessStartsAt && now < dbUser.accessStartsAt) return false;
  if (dbUser.accessExpiresAt && now > dbUser.accessExpiresAt) return false;
  return true;
}

/**
 * Whether a platform user restricted to specific organizations may act on the
 * given org (D3-A). An empty/absent restriction list means "all orgs". Enforced
 * by `platformOrgScopeError` in the authorize layer for every org-targeting
 * route — NOT the UI (ADR-024).
 */
export function platformOrgInScope(restrictedOrgIds: string[] | null | undefined, orgId: string): boolean {
  if (!restrictedOrgIds || restrictedOrgIds.length === 0) return true;
  return restrictedOrgIds.includes(orgId);
}
