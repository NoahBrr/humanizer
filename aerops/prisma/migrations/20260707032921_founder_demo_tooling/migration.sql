-- CreateEnum
CREATE TYPE "SimulationStatus" AS ENUM ('RUNNING', 'STOPPED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrgSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "data" JSONB NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "status" "SimulationStatus" NOT NULL DEFAULT 'RUNNING',
    "startedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "tickCount" INTEGER NOT NULL DEFAULT 0,
    "eventsCreated" INTEGER NOT NULL DEFAULT 0,
    "lastTickAt" TIMESTAMP(3),

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgSnapshot_organizationId_createdAt_idx" ON "OrgSnapshot"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SimulationRun_organizationId_status_idx" ON "SimulationRun"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "OrgSnapshot" ADD CONSTRAINT "OrgSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationRun" ADD CONSTRAINT "SimulationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
