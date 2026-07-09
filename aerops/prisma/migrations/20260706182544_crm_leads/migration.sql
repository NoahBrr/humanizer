-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'DISCOVERY_SCHEDULED', 'DISCOVERY_COMPLETED', 'APPLICATION', 'ENROLLED', 'LOST');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'website',
    "interest" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "estValue" DECIMAL(10,2),
    "priority" INTEGER NOT NULL DEFAULT 3,
    "assignedTo" TEXT,
    "notes" TEXT,
    "nextFollowUp" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_organizationId_status_idx" ON "Lead"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Lead_organizationId_nextFollowUp_idx" ON "Lead"("organizationId", "nextFollowUp");
