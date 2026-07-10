import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { OrgStatus, PlatformRole, Role } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { platformClaimsValid, platformAccessAllowed, platformAccessWindowActive, founderAccessAllowed, platformOrgInScope } from "@/lib/session-rules";
import { type Permission } from "@/lib/permissions";
import { resolvePermissions } from "@/lib/platform-users";
import { enabledModules, type ModuleKey } from "@/lib/features";
import { modulesForProfiles } from "@/lib/business-profiles";
import { readActiveImpersonation } from "@/lib/impersonation";

// Re-export the impersonation cookie helpers so existing importers of
// "@/lib/session" (the impersonate route) keep working after the split into
// lib/impersonation.ts (which audit.ts also reads, without the session graph).
export { IMPERSONATION_COOKIE, encodeImpersonation, decodeImpersonation, impersonationTtlMs } from "@/lib/impersonation";

/**
 * The one session shape the whole application consumes. Wraps the raw auth
 * token with everything Section-2 tenancy requires: resolved permissions,
 * org status, enabled modules, and (for platform staff) impersonation.
 * Pages and API routes must use getSession()/authorize() — never auth()
 * directly — so tenancy rules are enforced in exactly one place.
 */
export type AppSession = {
  /// "individual" = signed-in account that belongs to no organization yet
  /// (public sign-up). They see the /welcome onboarding surface only.
  kind: "org" | "platform" | "individual";
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Org-user fields (also set while impersonating) */
  organizationId: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
  orgStatus: OrgStatus;
  modules: Set<ModuleKey>;
  businessProfiles: string[];
  /** Platform-staff fields */
  platformRole?: PlatformRole;
  /** Immutable founder identity (D3-A / ADR-024) — set only by the bootstrap.
   *  Gates the founder-only console and founder-exclusive actions. */
  isFounder?: boolean;
  /** Read-only platform scope — refused all mutations (like read-only impersonation). */
  platformReadOnly?: boolean;
  /** If non-empty, this platform user may act only on these organization ids. */
  restrictedOrgIds?: string[];
  /** The platform user must rotate their password before acting. */
  mustChangePassword?: boolean;
  /** Present only while a platform user is impersonating a customer (ADR-023).
   *  `platformUserId` is the real staff actor; `session.userId` is the
   *  impersonated customer; `sessionId` links to the ImpersonationSession row. */
  impersonation?: { platformUserId: string; platformLabel: string; readOnly: boolean; sessionId?: string };
};

// --- Session resolution ------------------------------------------------------

async function orgSessionFor(userId: string, tokenSessionVersion?: number): Promise<Omit<AppSession, "kind" | "platformRole" | "impersonation"> | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      customRole: { select: { permissions: true } },
      organization: { select: { id: true, status: true, disabledModules: true, businessProfiles: true, plan: { select: { modules: true } } } },
    },
  });
  if (!user || !user.isActive || user.deletedAt) return null;
  // "Log out all devices" bumps sessionVersion; stale JWTs die here.
  if (tokenSessionVersion !== undefined && user.sessionVersion !== tokenSessionVersion) return null;
  // Individual account: signed in, but not yet part of any organization.
  if (!user.organizationId || !user.organization) {
    return {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationId: "",
      role: user.role,
      permissions: new Set() as ReadonlySet<Permission>,
      orgStatus: "ACTIVE" as OrgStatus,
      businessProfiles: [],
      modules: new Set<ModuleKey>(),
    };
  }
  const permissions = resolvePermissions(user.role, user.customRole?.permissions);
  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    organizationId: user.organizationId,
    role: user.role,
    permissions,
    orgStatus: user.organization.status,
    businessProfiles: user.organization.businessProfiles,
    modules: enabledModules(
      user.organization.plan?.modules,
      user.organization.disabledModules,
      modulesForProfiles(user.organization.businessProfiles),
    ),
  };
}

/** Resolve the effective session: org user, platform user, or platform user impersonating. */
export async function getSession(): Promise<AppSession | null> {
  const raw = await auth();
  if (!raw?.user?.id) return null;

  if (raw.user.platformRole) {
    // Platform power is verified against the database on EVERY request —
    // deactivation or a sessionVersion bump revokes all live JWTs at once.
    // The role also comes from the row, not the token, so demotions apply
    // immediately too.
    const platformUser = await db.platformUser.findUnique({
      where: { id: raw.user.id },
      select: {
        isActive: true, sessionVersion: true, role: true, firstName: true, lastName: true, email: true,
        isFounder: true, mustChangePassword: true, readOnly: true, restrictedOrgIds: true,
        accessStartsAt: true, accessExpiresAt: true,
      },
    });
    if (!platformClaimsValid(platformUser, raw.user.sessionVersion)) return null;
    // Time-boxed access: outside [accessStartsAt, accessExpiresAt] the platform
    // session is refused, so temporary/scheduled access expires on its own.
    if (!platformAccessWindowActive(platformUser, new Date())) return null;

    const imp = await readActiveImpersonation();
    if (imp && imp.platformUserId === raw.user.id) {
      const target = await orgSessionFor(imp.targetUserId);
      // Expiry, an ended session (cookie cleared), or a now-invalid target all
      // collapse back to a plain platform session below — stopping both
      // impersonated access and its audit attribution.
      if (target) {
        return {
          kind: "platform",
          ...target,
          platformRole: platformUser.role,
          isFounder: platformUser.isFounder,
          platformReadOnly: platformUser.readOnly,
          restrictedOrgIds: platformUser.restrictedOrgIds,
          mustChangePassword: platformUser.mustChangePassword,
          impersonation: {
            platformUserId: raw.user.id,
            platformLabel: imp.platformLabel,
            readOnly: imp.readOnly,
            sessionId: imp.sessionId,
          },
        };
      }
    }
    // Plain platform session — no organization context.
    return {
      kind: "platform",
      userId: raw.user.id,
      email: platformUser.email,
      firstName: platformUser.firstName,
      lastName: platformUser.lastName,
      organizationId: "",
      role: "SUPER_ADMIN",
      permissions: new Set(),
      orgStatus: "ACTIVE",
      modules: new Set(),
      businessProfiles: [],
      platformRole: platformUser.role,
      isFounder: platformUser.isFounder,
      platformReadOnly: platformUser.readOnly,
      restrictedOrgIds: platformUser.restrictedOrgIds,
      mustChangePassword: platformUser.mustChangePassword,
    };
  }

  // Symmetric with the platform path: an org/individual JWT without the
  // version claim fails closed. (orgSessionFor's optional param remains only
  // for impersonation-target resolution, where no token exists.)
  if (raw.user.sessionVersion === undefined) return null;
  const org = await orgSessionFor(raw.user.id, raw.user.sessionVersion);
  if (!org) return null;
  return { kind: org.organizationId ? "org" : "individual", ...org };
}

// --- API-key (service account) sessions ---------------------------------------

/**
 * Resolve a Bearer `aero_...` key into a scoped service-account session.
 * Keys flow through the SAME authorize() gate as humans: scopes are
 * permission keys, read-only keys are refused all mutations, org modules
 * and suspension apply identically. This is what makes /api/v1 a real
 * public API rather than a parallel implementation.
 */
async function apiKeySession(token: string): Promise<AppSession | null> {
  const key = await db.apiKey.findUnique({ where: { keyHash: hashToken(token) } });
  if (!key || key.revokedAt) return null;
  const org = await db.organization.findUnique({
    where: { id: key.organizationId },
    select: { status: true, disabledModules: true, businessProfiles: true, plan: { select: { modules: true } } },
  });
  if (!org) return null;
  db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return {
    kind: "org",
    userId: `apikey:${key.id}`,
    email: "",
    firstName: "API",
    lastName: key.name,
    organizationId: key.organizationId,
    role: "DISPATCHER",
    permissions: new Set(key.scopes as Permission[]),
    orgStatus: org.status,
    modules: enabledModules(org.plan?.modules, org.disabledModules, modulesForProfiles(org.businessProfiles)),
    businessProfiles: org.businessProfiles,
    ...(key.readOnly ? { impersonation: { platformUserId: "", platformLabel: `API key ${key.prefix}`, readOnly: true as const } } : {}),
  };
}

// --- Route-handler guards ------------------------------------------------------

type AuthorizeOk = { session: AppSession; error?: never };
type AuthorizeErr = { session?: never; error: NextResponse };

/**
 * Single permission gate for API routes. Handles: unauthenticated, suspended
 * organization, missing permission, and read-only impersonation (any
 * `mutating` call is refused so support staff can look but not touch).
 */
export async function authorize(permission: Permission | null, opts: { mutating?: boolean } = {}): Promise<AuthorizeOk | AuthorizeErr> {
  // Public API path: Bearer key beats the browser cookie.
  const authHeader = (await headers()).get("authorization");
  let session: AppSession | null = null;
  if (authHeader?.startsWith("Bearer aero_")) {
    session = await apiKeySession(authHeader.slice(7));
    if (!session) return { error: NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 }) };
  } else {
    session = await getSession();
  }
  if (!session || (session.kind === "platform" && !session.impersonation && !session.organizationId)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.kind === "individual") {
    return { error: NextResponse.json({ error: "Join or create an organization to use this feature." }, { status: 403 }) };
  }
  if (session.orgStatus !== "ACTIVE") {
    return { error: NextResponse.json({ error: "This organization is suspended. Contact AeroOps support." }, { status: 403 }) };
  }
  if (opts.mutating && session.impersonation?.readOnly) {
    const isApiKey = session.userId.startsWith("apikey:");
    return {
      error: NextResponse.json(
        { error: isApiKey ? "This API key is read-only — create a key with write scopes for mutations." : "Impersonation is read-only — changes are disabled." },
        { status: 403 },
      ),
    };
  }
  if (permission && !session.permissions.has(permission)) {
    return { error: NextResponse.json({ error: "You don't have permission for this action. Ask an administrator to grant it." }, { status: 403 }) };
  }
  // Module gating: the permission's namespace maps to a feature module; if
  // the org hasn't installed it (plan/profile), the API is off too — module
  // access is enforced here, not just hidden in navigation.
  if (permission) {
    const MODULE_BY_PREFIX: Record<string, ModuleKey> = {
      billing: "billing", maintenance: "maintenance", reports: "reports", documents: "documents",
    };
    const mod = MODULE_BY_PREFIX[permission.split(".")[0]];
    if (mod && !session.modules.has(mod)) {
      return { error: NextResponse.json({ error: "This module isn't enabled for your organization. An owner can activate it in Settings → Business Profiles." }, { status: 403 }) };
    }
  }
  return { session };
}

/**
 * Page-level guard for /platform server pages. The layout's check does NOT
 * re-run on client-side (soft) navigation, so every platform page must call
 * this itself — otherwise a revoked staff session keeps read access by
 * clicking between nav links (statically enforced by
 * tests/auth-security.test.ts).
 */
export async function requirePlatformSession(roles?: PlatformRole[]): Promise<AppSession> {
  const session = await getSession();
  if (!platformAccessAllowed(session)) redirect("/sign-in"); // customers never see /platform
  if (roles && !roles.includes(session.platformRole)) redirect("/platform/dashboard");
  return session;
}

/**
 * Guard for /platform API routes and pages. `opts.mutating` refuses the call
 * while an impersonation session is active — otherwise the acting identity is
 * the impersonated customer, so the audit actor and read-only impersonation
 * would both be wrong. Non-mutating calls (including ending impersonation) pass.
 */
export function platformOrgScopeError(session: AppSession | null | undefined, orgId: string | undefined): NextResponse | null {
  if (!orgId) return null;
  if (!session || session.kind !== "platform") return null;
  if (!platformOrgInScope(session.restrictedOrgIds, orgId)) {
    return NextResponse.json({ error: "Your platform access is restricted to specific organizations." }, { status: 403 });
  }
  return null;
}

export async function authorizePlatform(
  roles?: PlatformRole[],
  opts: { mutating?: boolean; orgId?: string } = {},
): Promise<AuthorizeOk | AuthorizeErr> {
  const session = await getSession();
  if (!platformAccessAllowed(session)) {
    return { error: NextResponse.json({ error: "Platform access required" }, { status: 403 }) };
  }
  if (opts.mutating && session.impersonation) {
    return { error: NextResponse.json({ error: "End the impersonation session before performing platform actions." }, { status: 403 }) };
  }
  // Read-only platform scope refuses every mutation (D3-A), like read-only impersonation.
  if (opts.mutating && session.platformReadOnly) {
    return { error: NextResponse.json({ error: "Your platform access is read-only." }, { status: 403 }) };
  }
  // Force a password rotation before any mutation (the password-change route
  // uses the non-mutating guard, so it stays reachable).
  if (opts.mutating && session.mustChangePassword) {
    return { error: NextResponse.json({ error: "Rotate your password before performing platform actions." }, { status: 403 }) };
  }
  // Org-scoped platform access: a restricted staff member may act only on their orgs.
  const scopeError = platformOrgScopeError(session, opts.orgId);
  if (scopeError) {
    return { error: scopeError };
  }
  if (roles && !roles.includes(session.platformRole)) {
    return { error: NextResponse.json({ error: "Your platform role cannot perform this action" }, { status: 403 }) };
  }
  return { session };
}

/**
 * Guard for founder-only /platform routes (D3-A / ADR-024). Requires the
 * immutable `isFounder` identity — never a role — so founder-exclusive surfaces
 * cannot be reached by granting a platform role in the UI. `opts.mutating`
 * additionally refuses the call while impersonating or under a read-only scope.
 */
export async function authorizeFounder(opts: { mutating?: boolean } = {}): Promise<AuthorizeOk | AuthorizeErr> {
  const session = await getSession();
  if (!platformAccessAllowed(session)) {
    return { error: NextResponse.json({ error: "Platform access required" }, { status: 403 }) };
  }
  if (!founderAccessAllowed(session)) {
    return { error: NextResponse.json({ error: "Founder access required" }, { status: 403 }) };
  }
  if (opts.mutating && session.impersonation) {
    return { error: NextResponse.json({ error: "End the impersonation session before performing founder actions." }, { status: 403 }) };
  }
  if (opts.mutating && session.platformReadOnly) {
    return { error: NextResponse.json({ error: "Your platform access is read-only." }, { status: 403 }) };
  }
  if (opts.mutating && session.mustChangePassword) {
    return { error: NextResponse.json({ error: "Rotate your password before performing founder actions." }, { status: 403 }) };
  }
  return { session };
}

/**
 * Page-level guard for founder-only /platform pages (D3-A). Every founder page
 * calls this itself (soft navigation doesn't re-run the layout) — customers go
 * to sign-in, non-founder staff to the platform dashboard.
 */
export async function requireFounderSession(): Promise<AppSession> {
  const session = await getSession();
  if (!platformAccessAllowed(session)) redirect("/sign-in");
  if (!founderAccessAllowed(session)) redirect("/platform/dashboard");
  return session;
}
