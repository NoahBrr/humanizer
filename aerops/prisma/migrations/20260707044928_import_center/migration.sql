-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('COMMITTED', 'ROLLED_BACK', 'ROLLBACK_PARTIAL');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByLabel" TEXT NOT NULL,
    "createdById" TEXT,
    "source" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "fileName" TEXT,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'COMMITTED',
    "mapping" JSONB NOT NULL,
    "options" JSONB,
    "totals" JSONB,
    "rowErrors" JSONB,
    "createdRecords" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_createdAt_idx" ON "ImportJob"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
