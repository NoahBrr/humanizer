import "server-only";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import type { OrgStatus, PlatformRole, Role } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { requireAuthSecret } from "@/lib/env";
import { platformClaimsValid } from "@/lib/session-rules";
import { permissionsForRole, type Permission } from "@/lib/permissions";
import { enabledModules, type ModuleKey } from "@/lib/features";
import { modulesForProfiles } from "@/lib/business-profiles";

export const IMPERSONATION_COOKIE = "aerops-impersonation";
const IMPERSONATION_TTL_MS = 60 * 60 * 1000;

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
  impersonation?: { platformUserId: string; platformLabel: string; readOnly: boolean };
};

// --- Impersonation cookie (HMAC-signed, short-lived) ------------------------

type ImpersonationPayload = { platformUserId: string; targetUserId: string; readOnly: boolean; exp: number };

function sign(data: string) {
  return createHmac("sha256", requireAuthSecret()).update(data).digest("base64url");
}

export function encodeImpersonation(payload: ImpersonationPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeImpersonation(value: string): ImpersonationPayload | null {
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as ImpersonationPayload;
  if (payload.exp < Date.now()) return null;
  return payload;
}

export function impersonationTtlMs() {
  return IMPERSONATION_TTL_MS;
}

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
  const permissions = user.customRole
    ? (new Set(user.customRole.permissions as Permission[]) as ReadonlySet<Permission>)
    : permissionsForRole(user.role);
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
      select: { isActive: true, sessionVersion: true, role: true, firstName: true, lastName: true, email: true },
    });
    if (!platformClaimsValid(platformUser, raw.user.sessionVersion)) return null;

    const cookieStore = await cookies();
    const impCookie = cookieStore.get(IMPERSONATION_COOKIE)?.value;
    const imp = impCookie ? decodeImpersonation(impCookie) : null;
    if (imp && imp.platformUserId === raw.user.id) {
      const target = await orgSessionFor(imp.targetUserId);
      if (target) {
        return {
          kind: "platform",
          ...target,
          platformRole: platformUser!.role,
          impersonation: {
            platformUserId: raw.user.id,
            platformLabel: `${platformUser!.firstName} ${platformUser!.lastName}`,
            readOnly: imp.readOnly,
          },
        };
      }
    }
    // Plain platform session — no organization context.
    return {
      kind: "platform",
      userId: raw.user.id,
      email: platformUser!.email,
      firstName: platformUser!.firstName,
      lastName: platformUser!.lastName,
      organizationId: "",
      role: "SUPER_ADMIN",
      permissions: new Set(),
      orgStatus: "ACTIVE",
      modules: new Set(),
      businessProfiles: [],
      platformRole: platformUser!.role,
    };
  }

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
  const keyHash = createHash("sha256").update(token).digest("hex");
  const key = await db.apiKey.findUnique({ where: { keyHash } });
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

/** Guard for /platform API routes and pages. */
export async function authorizePlatform(roles?: PlatformRole[]): Promise<AuthorizeOk | AuthorizeErr> {
  const session = await getSession();
  if (!session?.platformRole) {
    return { error: NextResponse.json({ error: "Platform access required" }, { status: 403 }) };
  }
  if (roles && !roles.includes(session.platformRole)) {
    return { error: NextResponse.json({ error: "Your platform role cannot perform this action" }, { status: 403 }) };
  }
  return { session };
}
