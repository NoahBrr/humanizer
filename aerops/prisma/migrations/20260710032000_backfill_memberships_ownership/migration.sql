-- Data backfill for ADR-023 (Phase D2): Membership becomes the source of truth
-- for organization affiliation and roles, and ACCOUNT_OWNER becomes the owner
-- role. Runs AFTER the DDL migration so the newly-added ACCOUNT_OWNER enum value
-- is already committed (Postgres forbids using a new enum value in the same
-- transaction that adds it). Idempotent and non-destructive — safe to re-run and
-- safe across fresh / seeded / demo / legacy databases.

-- 1. One membership per existing org-affiliated user — a projection of the
--    single organization they belong to today. Status mirrors account
--    activation; historical join time is preserved from the user's createdAt.
INSERT INTO "Membership" (
  "id", "userId", "organizationId", "role", "customRoleId",
  "primaryLocationId", "departmentId", "status", "deactivatedAt",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  u."id",
  u."organizationId",
  u."role",
  u."customRoleId",
  u."primaryLocationId",
  u."departmentId",
  CASE WHEN u."isActive" AND u."deletedAt" IS NULL
       THEN 'ACTIVE'::"MembershipStatus"
       ELSE 'DEACTIVATED'::"MembershipStatus" END,
  CASE WHEN u."isActive" AND u."deletedAt" IS NULL
       THEN NULL
       ELSE COALESCE(u."deletedAt", u."updatedAt") END,
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."organizationId" IS NOT NULL
ON CONFLICT ("userId", "organizationId") DO NOTHING;

-- 2. Owner invariant: the user referenced by Organization.ownerId — when that
--    user is an active member of the org — is promoted to ACCOUNT_OWNER on BOTH
--    the membership and the projected User.role. Ownerless orgs are deliberately
--    left untouched for the explicit remediation report (scripts/migration-report.ts) —
--    the migration never silently guesses an owner (Part 11).
UPDATE "Membership" m
SET "role" = 'ACCOUNT_OWNER'
FROM "Organization" o
JOIN "User" u ON u."id" = o."ownerId"
WHERE m."organizationId" = o."id"
  AND m."userId" = o."ownerId"
  AND u."isActive" AND u."deletedAt" IS NULL
  AND m."status" = 'ACTIVE'
  AND m."role" <> 'ACCOUNT_OWNER';

UPDATE "User" u
SET "role" = 'ACCOUNT_OWNER'
FROM "Organization" o
WHERE o."ownerId" = u."id"
  AND u."organizationId" = o."id"
  AND u."isActive" AND u."deletedAt" IS NULL
  AND u."role" <> 'ACCOUNT_OWNER';

-- 3. Retire the legacy SUPER_ADMIN organization role. Owners were already
--    promoted to ACCOUNT_OWNER in step 2; any remaining SUPER_ADMIN is a
--    non-owner administrator and becomes SCHOOL_ADMIN (Organization
--    Administrator — the same full-permission bundle, with no ownership
--    implication). The enum value itself is retained (dropping a Postgres enum
--    value is destructive); no code path assigns it after this migration.
UPDATE "Membership" SET "role" = 'SCHOOL_ADMIN' WHERE "role" = 'SUPER_ADMIN';
UPDATE "User" SET "role" = 'SCHOOL_ADMIN' WHERE "role" = 'SUPER_ADMIN';
