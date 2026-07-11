/*
  Warnings:

  - Added the required column `updatedAt` to the `Dispatch` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('DRAFT', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WetDryDesignation" AS ENUM ('WET', 'DRY', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('TAXABLE', 'NON_TAXABLE', 'INHERIT');

-- CreateEnum
CREATE TYPE "InstructorRateKind" AS ENUM ('BILLING', 'COMPENSATION');

-- CreateEnum
CREATE TYPE "InstructorClassification" AS ENUM ('EMPLOYEE', 'CONTRACTOR', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "InstructorTimeCategory" AS ENUM ('FLIGHT_INSTRUCTION', 'GROUND_INSTRUCTION', 'PREFLIGHT_BRIEFING', 'POSTFLIGHT_DEBRIEFING', 'SIMULATOR_INSTRUCTION', 'ORAL_PREPARATION', 'CHECKRIDE_PREPARATION', 'STAGE_CHECK', 'GROUND_SCHOOL', 'ADMINISTRATIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RevenueItemCategory" AS ENUM ('AIRPORT_FEE', 'FUEL_OIL', 'AIRCRAFT_FEE', 'SCHEDULING_FEE', 'INSTRUCTION', 'RETAIL', 'MEMBERSHIP', 'ADMINISTRATIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RevenueItemUnitBasis" AS ENUM ('PER_HOUR', 'PER_LANDING', 'PER_FLIGHT', 'PER_DAY', 'PER_UNIT', 'FIXED');

-- CreateEnum
CREATE TYPE "RevenueItemAmountMode" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "RevenueItemRisk" AS ENUM ('NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('PARENT', 'GUARDIAN', 'EMPLOYER', 'SCHOLARSHIP_SPONSOR', 'UNIVERSITY', 'CLUB_SPONSOR', 'OTHER');

-- CreateEnum
CREATE TYPE "PayerStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PayerRelationshipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- AlterTable
ALTER TABLE "Dispatch" ADD COLUMN     "airportsVisited" TEXT,
ADD COLUMN     "closedBy" TEXT,
ADD COLUMN     "closeoutWarnings" JSONB,
ADD COLUMN     "conditionIn" TEXT,
ADD COLUMN     "conditionOut" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "intendedRoute" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "oilAddedQt" DECIMAL(4,1),
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "payerId" TEXT,
ADD COLUMN     "pricingProfileId" TEXT,
ADD COLUMN     "releaseNotes" TEXT,
ADD COLUMN     "restrictionSnapshot" JSONB,
ADD COLUMN     "returnNotes" TEXT,
ADD COLUMN     "squawksAcknowledged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AircraftPricingProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "aircraftId" TEXT,
    "locationId" TEXT,
    "familyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "billingBasis" "PricingBillingBasis" NOT NULL DEFAULT 'HOBBS',
    "customUnitLabel" TEXT,
    "wetDry" "WetDryDesignation" NOT NULL DEFAULT 'WET',
    "rateAmount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "minBillableQuantity" DECIMAL(6,2),
    "roundingRule" "PricingRoundingRule" NOT NULL DEFAULT 'NEAREST_TENTH',
    "taxTreatment" "TaxTreatment",
    "includedFeeItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibleMembershipRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibleCustomerTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibleProgramIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "effectiveStart" TIMESTAMP(3) NOT NULL,
    "effectiveEnd" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdByLabel" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedByLabel" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AircraftPricingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorRateProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "InstructorRateKind" NOT NULL,
    "instructorId" TEXT,
    "locationId" TEXT,
    "syllabusId" TEXT,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "familyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "classification" "InstructorClassification" NOT NULL DEFAULT 'UNSPECIFIED',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "taxTreatment" "TaxTreatment",
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdByLabel" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedByLabel" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorRateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorRateProfileLine" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "category" "InstructorTimeCategory" NOT NULL,
    "customLabel" TEXT NOT NULL DEFAULT '',
    "rate" DECIMAL(12,2),
    "percentOfBilling" DECIMAL(5,2),
    "minBillableHours" DECIMAL(4,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructorRateProfileLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "RevenueItemCategory" NOT NULL,
    "unitBasis" "RevenueItemUnitBasis" NOT NULL,
    "unitLabel" TEXT,
    "amountMode" "RevenueItemAmountMode" NOT NULL,
    "defaultAmount" DECIMAL(12,2),
    "minAmount" DECIMAL(12,2),
    "maxAmount" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "isTaxable" BOOLEAN NOT NULL DEFAULT false,
    "riskLevel" "RevenueItemRisk" NOT NULL DEFAULT 'NORMAL',
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "requiresAttachment" BOOLEAN NOT NULL DEFAULT false,
    "requiresSecondApproval" BOOLEAN NOT NULL DEFAULT false,
    "defaultAccountingCategoryCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueItemLocation" (
    "id" TEXT NOT NULL,
    "revenueItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueItemLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueItemProgram" (
    "id" TEXT NOT NULL,
    "revenueItemId" TEXT NOT NULL,
    "syllabusId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueItemProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueItemAircraft" (
    "id" TEXT NOT NULL,
    "revenueItemId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueItemAircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "jurisdictionLabel" TEXT NOT NULL,
    "ratePercent" DECIMAL(7,4) NOT NULL,
    "appliesToKinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "effectiveStart" TIMESTAMP(3) NOT NULL,
    "effectiveEnd" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsiblePayer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "payerType" "PayerType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" "PayerStatus" NOT NULL DEFAULT 'INVITED',
    "billingAuthorizationVersion" TEXT,
    "billingAuthorizationAcceptedAt" TIMESTAMP(3),
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "invitedByLabel" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponsiblePayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPayerRelationship" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "status" "PayerRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "canViewInvoices" BOOLEAN NOT NULL DEFAULT true,
    "canManagePaymentMethods" BOOLEAN NOT NULL DEFAULT true,
    "receivesNotifications" BOOLEAN NOT NULL DEFAULT true,
    "chargeApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "guardianConsentAt" TIMESTAMP(3),
    "guardianConsentByLabel" TEXT,
    "consentDocumentId" TEXT,
    "studentAcknowledgedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPayerRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchRestrictionDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "key" "CheckoutRestrictionKey" NOT NULL,
    "kind" "RestrictionDecisionKind" NOT NULL,
    "category" "RestrictionCategory" NOT NULL,
    "enforcementAtTime" "RestrictionEnforcement" NOT NULL,
    "findingDetail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchRestrictionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AircraftPricingProfile_organizationId_status_idx" ON "AircraftPricingProfile"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AircraftPricingProfile_organizationId_aircraftId_effectiveS_idx" ON "AircraftPricingProfile"("organizationId", "aircraftId", "effectiveStart");

-- CreateIndex
CREATE INDEX "AircraftPricingProfile_organizationId_effectiveStart_idx" ON "AircraftPricingProfile"("organizationId", "effectiveStart");

-- CreateIndex
CREATE UNIQUE INDEX "AircraftPricingProfile_organizationId_familyId_version_key" ON "AircraftPricingProfile"("organizationId", "familyId", "version");

-- CreateIndex
CREATE INDEX "InstructorRateProfile_organizationId_kind_status_idx" ON "InstructorRateProfile"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "InstructorRateProfile_organizationId_instructorId_kind_idx" ON "InstructorRateProfile"("organizationId", "instructorId", "kind");

-- CreateIndex
CREATE INDEX "InstructorRateProfile_organizationId_effectiveFrom_idx" ON "InstructorRateProfile"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorRateProfile_organizationId_kind_familyId_version_key" ON "InstructorRateProfile"("organizationId", "kind", "familyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "InstructorRateProfileLine_profileId_category_customLabel_key" ON "InstructorRateProfileLine"("profileId", "category", "customLabel");

-- CreateIndex
CREATE INDEX "RevenueItem_organizationId_isActive_category_idx" ON "RevenueItem"("organizationId", "isActive", "category");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueItem_organizationId_code_key" ON "RevenueItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "RevenueItemLocation_locationId_idx" ON "RevenueItemLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueItemLocation_revenueItemId_locationId_key" ON "RevenueItemLocation"("revenueItemId", "locationId");

-- CreateIndex
CREATE INDEX "RevenueItemProgram_syllabusId_idx" ON "RevenueItemProgram"("syllabusId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueItemProgram_revenueItemId_syllabusId_key" ON "RevenueItemProgram"("revenueItemId", "syllabusId");

-- CreateIndex
CREATE INDEX "RevenueItemAircraft_aircraftId_idx" ON "RevenueItemAircraft"("aircraftId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueItemAircraft_revenueItemId_aircraftId_key" ON "RevenueItemAircraft"("revenueItemId", "aircraftId");

-- CreateIndex
CREATE INDEX "TaxRule_organizationId_isActive_idx" ON "TaxRule"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "TaxRule_organizationId_locationId_isActive_idx" ON "TaxRule"("organizationId", "locationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_organizationId_ruleKey_version_key" ON "TaxRule"("organizationId", "ruleKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ResponsiblePayer_inviteTokenHash_key" ON "ResponsiblePayer"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "ResponsiblePayer_organizationId_status_idx" ON "ResponsiblePayer"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ResponsiblePayer_organizationId_email_idx" ON "ResponsiblePayer"("organizationId", "email");

-- CreateIndex
CREATE INDEX "ResponsiblePayer_userId_idx" ON "ResponsiblePayer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ResponsiblePayer_organizationId_userId_key" ON "ResponsiblePayer"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "StudentPayerRelationship_organizationId_status_idx" ON "StudentPayerRelationship"("organizationId", "status");

-- CreateIndex
CREATE INDEX "StudentPayerRelationship_payerId_status_idx" ON "StudentPayerRelationship"("payerId", "status");

-- CreateIndex
CREATE INDEX "StudentPayerRelationship_studentId_status_idx" ON "StudentPayerRelationship"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPayerRelationship_studentId_payerId_key" ON "StudentPayerRelationship"("studentId", "payerId");

-- CreateIndex
CREATE INDEX "DispatchRestrictionDecision_organizationId_createdAt_idx" ON "DispatchRestrictionDecision"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DispatchRestrictionDecision_organizationId_key_createdAt_idx" ON "DispatchRestrictionDecision"("organizationId", "key", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchRestrictionDecision_dispatchId_key_key" ON "DispatchRestrictionDecision"("dispatchId", "key");

-- CreateIndex
CREATE INDEX "Dispatch_organizationId_status_idx" ON "Dispatch"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Dispatch_organizationId_closedAt_idx" ON "Dispatch"("organizationId", "closedAt");

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "ResponsiblePayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_pricingProfileId_fkey" FOREIGN KEY ("pricingProfileId") REFERENCES "AircraftPricingProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftPricingProfile" ADD CONSTRAINT "AircraftPricingProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftPricingProfile" ADD CONSTRAINT "AircraftPricingProfile_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AircraftPricingProfile" ADD CONSTRAINT "AircraftPricingProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorRateProfile" ADD CONSTRAINT "InstructorRateProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorRateProfile" ADD CONSTRAINT "InstructorRateProfile_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorRateProfile" ADD CONSTRAINT "InstructorRateProfile_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorRateProfile" ADD CONSTRAINT "InstructorRateProfile_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES "Syllabus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorRateProfileLine" ADD CONSTRAINT "InstructorRateProfileLine_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "InstructorRateProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueItem" ADD CONSTRAINT "RevenueItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueItemLocation" ADD CONSTRAINT "RevenueItemLocation_revenueItemId_fkey" FOREIGN KEY ("revenueItemId") REFERENCES "RevenueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueItemLocation" ADD CONSTRAINT "RevenueItemLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueItemProgram" ADD CONSTRAINT "RevenueItemProgram_revenueItemId_fkey" FOREIGN KEY ("revenueItemId") REFERENCES "RevenueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueItemProgram" ADD CONSTRAINT "RevenueItemProgram_syllabusId_fkey" FOREIGN KEY ("syllabusId") REFERENCES "Syllabus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueItemAircraft" ADD CONSTRAINT "RevenueItemAircraft_revenueItemId_fkey" FOREIGN KEY ("revenueItemId") REFERENCES "RevenueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueItemAircraft" ADD CONSTRAINT "RevenueItemAircraft_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsiblePayer" ADD CONSTRAINT "ResponsiblePayer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsiblePayer" ADD CONSTRAINT "ResponsiblePayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayerRelationship" ADD CONSTRAINT "StudentPayerRelationship_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayerRelationship" ADD CONSTRAINT "StudentPayerRelationship_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayerRelationship" ADD CONSTRAINT "StudentPayerRelationship_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "ResponsiblePayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPayerRelationship" ADD CONSTRAINT "StudentPayerRelationship_consentDocumentId_fkey" FOREIGN KEY ("consentDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRestrictionDecision" ADD CONSTRAINT "DispatchRestrictionDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchRestrictionDecision" ADD CONSTRAINT "DispatchRestrictionDecision_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (partial unique — Prisma cannot express a WHERE-filtered unique index)
-- At most one default ACTIVE payer per student; revoked/pending rows are exempt.
CREATE UNIQUE INDEX "StudentPayerRelationship_default_key" ON "StudentPayerRelationship"("studentId") WHERE "isDefault" AND status = 'ACTIVE';
