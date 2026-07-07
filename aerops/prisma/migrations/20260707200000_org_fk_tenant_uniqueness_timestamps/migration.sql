-- Phase 1C: organization FK integrity, tenant-scoped uniqueness, timestamps.
-- Additive + constraint changes (no column drops). tailNumber/invoice number
-- move from GLOBAL unique to per-organization unique (strictly less
-- restrictive → cannot introduce a within-org collision). 9 org-owned tables
-- gain a real Organization FK (LoginEvent SET NULL to preserve the security
-- log like AuditLog; the rest CASCADE). See ADR-021.

-- DropIndex
DROP INDEX "Aircraft_tailNumber_key";

-- DropIndex
DROP INDEX "Invoice_number_key";

-- AlterTable
ALTER TABLE "Aircraft" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "LessonType" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Syllabus" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "Aircraft_organizationId_tailNumber_key" ON "Aircraft"("organizationId", "tailNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_organizationId_number_key" ON "Invoice"("organizationId", "number");

-- Remediate pre-existing orphans (rows whose organizationId references an
-- Organization that no longer exists — only possible because these tables
-- lacked the FK being added here). Matches the FK's onDelete semantics:
-- LoginEvent is SET NULL (preserve the security log), the rest CASCADE
-- (delete, as they would have been when the org was removed). Idempotent.
UPDATE "LoginEvent" SET "organizationId" = NULL
  WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "LoginEvent"."organizationId");
DELETE FROM "LessonRequest" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "LessonRequest"."organizationId");
DELETE FROM "WaitlistEntry" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "WaitlistEntry"."organizationId");
DELETE FROM "Lead" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "Lead"."organizationId");
DELETE FROM "ApiKey" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "ApiKey"."organizationId");
DELETE FROM "Webhook" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "Webhook"."organizationId");
DELETE FROM "Part" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "Part"."organizationId");
DELETE FROM "MissionControlScene" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "MissionControlScene"."organizationId");
DELETE FROM "PlatformNote" WHERE "organizationId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = "PlatformNote"."organizationId");

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonRequest" ADD CONSTRAINT "LessonRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Part" ADD CONSTRAINT "Part_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionControlScene" ADD CONSTRAINT "MissionControlScene_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformNote" ADD CONSTRAINT "PlatformNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;