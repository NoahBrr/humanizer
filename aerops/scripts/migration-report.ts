/**
 * Phase D2 ownership-migration report (ADR-023, spec Part 11). READ-ONLY.
 *
 * Inventories organization-ownership health and legacy-role state so an operator
 * can remediate ambiguous cases explicitly. This tool MUTATES NOTHING: there is
 * deliberately no --apply / write path. Ownerless orgs with zero or more-than-one
 * effective-admin candidate require an explicit human decision — the tool never
 * silently guesses an owner (the backfill migration leaves them for this report).
 *
 * Usage:
 *   npx tsx scripts/migration-report.ts          human-readable report
 *   npx tsx scripts/migration-report.ts --json   same data as one JSON object
 *
 * Connects with a bare PrismaClient (mirrors prisma/seed.ts); the "@/" alias is
 * used only transitively by the pure helpers below, which tsx resolves via
 * tsconfig paths.
 */
import { PrismaClient, Role, MembershipStatus } from "@prisma/client";
import { resolvePermissions, isEffectiveAdmin } from "../src/lib/platform-users";

const db = new PrismaClient();

type Person = { id: string; name: string; email: string };

function personOf(u: { id: string; firstName: string; lastName: string; email: string }): Person {
  return { id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), email: u.email };
}

async function buildReport() {
  // Only non-deleted organizations are in scope for the migration report.
  const orgs = await db.organization.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, ownerId: true },
    orderBy: { name: "asc" },
  });

  // Every membership with the facts needed to (a) resolve effective-admin status
  // — customRole permissions win over the built-in role (resolvePermissions) —
  // and (b) count ACCOUNT_OWNER holders per org.
  const memberships = await db.membership.findMany({
    select: {
      userId: true,
      organizationId: true,
      role: true,
      status: true,
      customRole: { select: { permissions: true } },
      user: { select: { id: true, firstName: true, lastName: true, email: true, isActive: true, deletedAt: true } },
    },
  });

  // Organization.ownerId is a bare String with no FK, so it may dangle; resolve
  // owner users directly (an owner may also have no membership row at all).
  const ownerIds = [...new Set(orgs.map((o) => o.ownerId).filter((v): v is string => !!v))];
  const ownerUsers = ownerIds.length
    ? await db.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, firstName: true, lastName: true, email: true, isActive: true, deletedAt: true },
      })
    : [];
  const ownersById = new Map(ownerUsers.map((u) => [u.id, u]));

  // Projection-drift source: live users that claim an organization.
  const usersWithOrg = await db.user.findMany({
    where: { deletedAt: null, organizationId: { not: null } },
    select: { id: true, firstName: true, lastName: true, email: true, organizationId: true },
  });

  // Legacy SUPER_ADMIN state (should be 0 post-migration).
  const superAdminUsers = await db.user.count({ where: { role: Role.SUPER_ADMIN } });
  const superAdminMemberships = memberships.filter((m) => m.role === Role.SUPER_ADMIN).length;

  // Group memberships by org, and index (userId::orgId) presence for drift.
  const byOrg = new Map<string, typeof memberships>();
  const membershipKeys = new Set<string>();
  for (const m of memberships) {
    membershipKeys.add(`${m.userId}::${m.organizationId}`);
    const list = byOrg.get(m.organizationId);
    if (list) list.push(m);
    else byOrg.set(m.organizationId, [m]);
  }

  const ownerless: {
    id: string;
    name: string;
    classification: "UNAMBIGUOUS" | "AMBIGUOUS";
    reason: string;
    recommendedOwner: Person | null;
    candidates: Person[];
  }[] = [];
  const violations: { id: string; name: string; ownerId: string; reasons: string[] }[] = [];

  for (const org of orgs) {
    const orgMemberships = byOrg.get(org.id) ?? [];
    const owner = org.ownerId ? ownersById.get(org.ownerId) ?? null : null;
    const ownerLive = !!owner && owner.isActive && !owner.deletedAt;
    const hasValidOwner = !!org.ownerId && ownerLive;

    // Active effective-admins who could actually receive ownership: an ACTIVE
    // membership held by a live user whose effective permissions include
    // settings.manage (mirrors canTransferOwnerTo's eligibility rules).
    const candidates = orgMemberships
      .filter(
        (m) =>
          m.status === MembershipStatus.ACTIVE &&
          m.user.isActive &&
          !m.user.deletedAt &&
          isEffectiveAdmin(resolvePermissions(m.role, m.customRole?.permissions)),
      )
      .map((m) => personOf(m.user));

    if (!hasValidOwner) {
      if (candidates.length === 1) {
        ownerless.push({
          id: org.id,
          name: org.name,
          classification: "UNAMBIGUOUS",
          reason: "Exactly one active effective-admin member.",
          recommendedOwner: candidates[0],
          candidates,
        });
      } else {
        ownerless.push({
          id: org.id,
          name: org.name,
          classification: "AMBIGUOUS",
          reason:
            candidates.length === 0
              ? "No active effective-admin member to promote."
              : `${candidates.length} active effective-admin members — cannot choose automatically.`,
          recommendedOwner: null,
          candidates,
        });
      }
    }

    // Ownership invariant (ADR-023) applies to every org that claims an owner.
    if (org.ownerId) {
      const accountOwnerMemberships = orgMemberships.filter((m) => m.role === Role.ACCOUNT_OWNER);
      const ownerHasActiveAO = orgMemberships.some(
        (m) => m.userId === org.ownerId && m.role === Role.ACCOUNT_OWNER && m.status === MembershipStatus.ACTIVE,
      );
      const reasons: string[] = [];
      if (!owner) reasons.push("ownerId points to a user that does not exist.");
      else if (owner.deletedAt) reasons.push("owner user is soft-deleted.");
      else if (!owner.isActive) reasons.push("owner user is inactive.");
      if (!ownerHasActiveAO) reasons.push("owner has no active ACCOUNT_OWNER membership in the org.");
      if (accountOwnerMemberships.length !== 1) {
        reasons.push(`org has ${accountOwnerMemberships.length} ACCOUNT_OWNER membership(s) (expected exactly 1).`);
      }
      if (reasons.length) violations.push({ id: org.id, name: org.name, ownerId: org.ownerId, reasons });
    }
  }

  // Projection drift: a live user claims an org but has no membership row for it.
  const drift = usersWithOrg
    .filter((u) => u.organizationId && !membershipKeys.has(`${u.id}::${u.organizationId}`))
    .map((u) => ({ ...personOf(u), organizationId: u.organizationId as string }));

  const clean =
    ownerless.length === 0 &&
    violations.length === 0 &&
    superAdminUsers === 0 &&
    superAdminMemberships === 0 &&
    drift.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalOrgs: orgs.length,
      ownedOrgs: orgs.length - ownerless.length,
      ownerlessOrgs: ownerless.length,
    },
    ownerless,
    invariantViolations: violations,
    legacyRoles: { superAdminUsers, superAdminMemberships },
    drift: { count: drift.length, users: drift },
    verdict: clean ? ("PASS" as const) : ("ATTENTION" as const),
  };
}

type Report = Awaited<ReturnType<typeof buildReport>>;

function printHuman(r: Report): void {
  const L = (s = "") => console.log(s);
  const bar = "=".repeat(74);

  L(bar);
  L("  AeroOps - Phase D2 Ownership Migration Report (READ-ONLY)");
  L(`  Generated ${r.generatedAt}`);
  L(bar);
  L();

  L("1. SUMMARY");
  L(`   Non-deleted organizations : ${r.summary.totalOrgs}`);
  L(`   With a valid owner        : ${r.summary.ownedOrgs}`);
  L(`   Ownerless                 : ${r.summary.ownerlessOrgs}`);
  L();

  L("2. OWNERLESS ORGANIZATIONS");
  if (!r.ownerless.length) {
    L("   None. Every non-deleted organization has a valid, live owner.");
  } else {
    for (const o of r.ownerless) {
      L(`   - ${o.name}  (${o.id})`);
      L(`       Classification: ${o.classification} - ${o.reason}`);
      if (o.classification === "UNAMBIGUOUS" && o.recommendedOwner) {
        L(`       Recommended owner (deterministic candidate): ${o.recommendedOwner.name} <${o.recommendedOwner.email}>`);
      } else {
        L("       Requires explicit manual decision.");
        if (o.candidates.length) {
          L("       Candidate members:");
          for (const c of o.candidates) L(`         - ${c.name} <${c.email}>`);
        }
      }
    }
  }
  L();

  L("3. OWNERSHIP INVARIANT VIOLATIONS");
  if (!r.invariantViolations.length) {
    L("   None. Every owned organization satisfies the ADR-023 invariant.");
  } else {
    for (const v of r.invariantViolations) {
      L(`   - ${v.name}  (${v.id})  ownerId=${v.ownerId}`);
      for (const reason of v.reasons) L(`       * ${reason}`);
    }
  }
  L();

  L("4. LEGACY ROLES (expected 0 after migration)");
  const uFlag = r.legacyRoles.superAdminUsers > 0 ? "   [FLAG]" : "";
  const mFlag = r.legacyRoles.superAdminMemberships > 0 ? "   [FLAG]" : "";
  L(`   Users with role SUPER_ADMIN       : ${r.legacyRoles.superAdminUsers}${uFlag}`);
  L(`   Memberships with role SUPER_ADMIN : ${r.legacyRoles.superAdminMemberships}${mFlag}`);
  L();

  L("5. MEMBERSHIP / PROJECTION DRIFT (expected 0)");
  const dFlag = r.drift.count > 0 ? "   [FLAG]" : "";
  L(`   Live users with organizationId but no membership row : ${r.drift.count}${dFlag}`);
  for (const u of r.drift.users) L(`     - ${u.name} <${u.email}>  organizationId=${u.organizationId}`);
  L();

  L(bar);
  if (r.verdict === "PASS") {
    L("  VERDICT: PASS - ownership migration is healthy; no action required.");
  } else {
    L("  VERDICT: ATTENTION - items above require explicit remediation.");
  }
  L(bar);
}

async function main(): Promise<void> {
  const report = await buildReport();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
