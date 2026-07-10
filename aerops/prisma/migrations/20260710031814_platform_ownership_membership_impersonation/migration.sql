-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('PART_61_FLIGHT_SCHOOL', 'PART_141_FLIGHT_SCHOOL', 'FLYING_CLUB', 'UNIVERSITY_PROGRAM', 'CORPORATE_FLIGHT_DEPT', 'MAINTENANCE_ORG', 'OTHER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'MANUAL');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'LIVE');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('MANUAL', 'STRIPE');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DEACTIVATED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'ACCOUNT_OWNER';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "impersonatedUserId" TEXT,
ADD COLUMN     "impersonationSessionId" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "address" TEXT,
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingMode" "BillingMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isDiscoverable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "logoObjectKey" TEXT,
ADD COLUMN     "maxAircraftOverride" INTEGER,
ADD COLUMN     "maxUsersOverride" INTEGER,
ADD COLUMN     "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "orgType" "OrgType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "primaryContactEmail" TEXT,
ADD COLUMN     "primaryContactName" TEXT,
ADD COLUMN     "primaryContactPhone" TEXT,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "customRoleId" TEXT,
    "primaryLocationId" TEXT,
    "departmentId" TEXT,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedByLabel" TEXT,
    "approvedByLabel" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationSession" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Membership_organizationId_status_idx" ON "Membership"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Membership_userId_status_idx" ON "Membership"("userId", "status");

-- CreateIndex
CREATE INDEX "Membership_organizationId_role_idx" ON "Membership"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "ImpersonationSession_platformUserId_startedAt_idx" ON "ImpersonationSession"("platformUserId", "startedAt");

-- CreateIndex
CREATE INDEX "ImpersonationSession_organizationId_startedAt_idx" ON "ImpersonationSession"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "ImpersonationSession_targetUserId_idx" ON "ImpersonationSession"("targetUserId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_impersonatedUserId_createdAt_idx" ON "AuditLog"("impersonatedUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_impersonationSessionId_idx" ON "AuditLog"("impersonationSessionId");

-- CreateIndex
CREATE INDEX "Organization_orgType_idx" ON "Organization"("orgType");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_impersonatedUserId_fkey" FOREIGN KEY ("impersonatedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_impersonationSessionId_fkey" FOREIGN KEY ("impersonationSessionId") REFERENCES "ImpersonationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "OrgRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationSession" ADD CONSTRAINT "ImpersonationSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
