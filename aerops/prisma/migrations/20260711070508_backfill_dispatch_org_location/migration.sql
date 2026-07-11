-- M16 backfill (additive data migration): populate Dispatch.organizationId and
-- Dispatch.locationId for pre-Phase-2 rows from their ScheduleEvent / Aircraft.
-- Idempotent — the IS NULL guards make a re-run a no-op.
UPDATE "Dispatch" d SET "organizationId" = se."organizationId" FROM "ScheduleEvent" se WHERE d."scheduleEventId" = se."id" AND d."organizationId" IS NULL;
UPDATE "Dispatch" d SET "locationId" = COALESCE(se."locationId", a."locationId") FROM "ScheduleEvent" se, "Aircraft" a WHERE d."scheduleEventId" = se."id" AND d."aircraftId" = a."id" AND d."locationId" IS NULL;

-- Reconcile schema drift: Dispatch.updatedAt (@updatedAt, no @default) carried a
-- temporary DB DEFAULT CURRENT_TIMESTAMP added by hand in the prior migration so
-- the 23 existing rows could backfill on ADD COLUMN. Now that every row has a
-- value, drop the default to match schema.prisma (the Prisma client supplies
-- updatedAt on every write). This clears the only schema<->DB drift.
ALTER TABLE "Dispatch" ALTER COLUMN "updatedAt" DROP DEFAULT;
