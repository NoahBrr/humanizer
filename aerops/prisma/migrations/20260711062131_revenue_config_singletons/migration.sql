-- CreateEnum
CREATE TYPE "WarningMode" AS ENUM ('OFF', 'WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "CheckoutRestrictionKey" AS ENUM ('AIRCRAFT_GROUNDED', 'MAINTENANCE_OVERDUE', 'OPEN_CRITICAL_SQUAWK', 'MEDICAL_EXPIRED', 'CERTIFICATE_EXPIRED', 'INSTRUCTOR_NOT_CURRENT', 'STUDENT_NOT_CURRENT', 'ENDORSEMENT_MISSING', 'MAINTENANCE_DUE_SOON', 'PROGRAM_REQUIREMENTS_INCOMPLETE', 'INSURANCE_DOCUMENT_MISSING', 'PAYMENT_METHOD_MISSING', 'PRIOR_PAYMENT_FAILED', 'AMOUNT_DUE_OVER_THRESHOLD', 'MEMBERSHIP_INACTIVE');

-- CreateEnum
CREATE TYPE "RestrictionEnforcement" AS ENUM ('OFF', 'WARN', 'REQUIRE_REVIEW', 'BLOCK_OVERRIDABLE', 'BLOCK');

-- CreateEnum
CREATE TYPE "RestrictionCategory" AS ENUM ('SAFETY', 'OPERATIONAL', 'FINANCIAL');

-- CreateEnum
CREATE TYPE "RestrictionDecisionKind" AS ENUM ('OVERRIDE', 'REVIEW_CLEARED');

-- CreateEnum
CREATE TYPE "PaymentTimingPolicy" AS ENUM ('IMMEDIATE_ON_APPROVAL', 'SAME_DAY_BATCH', 'NIGHTLY_BATCH', 'WEEKLY_BATCH', 'MANUAL_CHARGE', 'MANUAL_INVOICE', 'ACH_ONLY_BATCH', 'CUSTOM_DATE');

-- CreateEnum
CREATE TYPE "MappingSourceType" AS ENUM ('ALLOCATION_CATEGORY', 'LEDGER_ACCOUNT', 'REVENUE_ITEM', 'TAX_CODE', 'PAYMENT_METHOD');

-- CreateEnum
CREATE TYPE "PricingBillingBasis" AS ENUM ('HOBBS', 'TACH', 'FIXED', 'CUSTOM_UNIT');

-- CreateEnum
CREATE TYPE "PricingRoundingRule" AS ENUM ('NEAREST_TENTH', 'NEAREST_HUNDREDTH', 'UP_TENTH', 'UP_HUNDREDTH', 'NONE');

-- CreateEnum
CREATE TYPE "TaxProvider" AS ENUM ('INTERNAL', 'STRIPE_TAX');

-- CreateEnum
CREATE TYPE "TaxRoundingMode" AS ENUM ('HALF_UP', 'HALF_EVEN');

-- CreateEnum
CREATE TYPE "TaxRoundingLevel" AS ENUM ('PER_RULE_TOTAL', 'PER_LINE');

-- CreateEnum
CREATE TYPE "TimeRoundingMode" AS ENUM ('DECIMAL_FREE', 'TENTH', 'HUNDREDTH', 'MINUTE');

-- CreateEnum
CREATE TYPE "FlightTimeSuggestionMode" AS ENUM ('SUGGEST_CONFIRM', 'AUTO_FILL', 'MANUAL_ONLY');

-- CreateEnum
CREATE TYPE "HobbsDivergenceAction" AS ENUM ('WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "InstructorClawbackPolicy" AS ENUM ('NEVER', 'SERVICE_LINES_ONLY', 'ALWAYS_PRO_RATA');

-- CreateEnum
CREATE TYPE "DiscountAllocationMode" AS ENUM ('TARGET_CATEGORY', 'PROPORTIONAL');

-- CreateEnum
CREATE TYPE "CompensationApprovalMode" AS ENUM ('AUTO_ON_REVIEW_APPROVAL', 'SEPARATE_APPROVAL');

-- CreateEnum
CREATE TYPE "CompensationRefundPolicy" AS ENUM ('REQUIRE_APPROVAL', 'AUTO_REVERSE', 'NEVER');

-- CreateEnum
CREATE TYPE "PayerChargeApprovalMode" AS ENUM ('OFF', 'PER_RELATIONSHIP');

-- CreateEnum
CREATE TYPE "AdultStudentConsentMode" AS ENUM ('ORG_AUTHORITY', 'STUDENT_ACKNOWLEDGE');

-- CreateEnum
CREATE TYPE "MinorPayerPolicy" AS ENUM ('OFF', 'WARN', 'REQUIRE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'REFUNDED';
ALTER TYPE "InvoiceStatus" ADD VALUE 'DISPUTED';

-- CreateTable
CREATE TABLE "OrgSequence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueWorkflowPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instructorSubmissionRequired" BOOLEAN NOT NULL DEFAULT true,
    "instructorMayApproveRoutine" BOOLEAN NOT NULL DEFAULT false,
    "routineApprovalMaxAmount" DECIMAL(12,2),
    "operationsApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "secondApprovalAmountThreshold" DECIMAL(12,2),
    "secondApprovalForManualItems" BOOLEAN NOT NULL DEFAULT false,
    "secondApprovalForDamageFees" BOOLEAN NOT NULL DEFAULT true,
    "secondApprovalForRefunds" BOOLEAN NOT NULL DEFAULT true,
    "financeApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "separationOfDutiesRequired" BOOLEAN NOT NULL DEFAULT true,
    "instructorSeesOwnCompensation" BOOLEAN NOT NULL DEFAULT false,
    "discountSecondApprovalPercent" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "discountSecondApprovalAmount" DECIMAL(12,2) NOT NULL DEFAULT 250.00,
    "damageFeeWaiverSecondApproval" BOOLEAN NOT NULL DEFAULT true,
    "creditIssueSecondApprovalAmount" DECIMAL(12,2) NOT NULL DEFAULT 500.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueWorkflowPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "captureFuelStatus" BOOLEAN NOT NULL DEFAULT true,
    "captureOilStatus" BOOLEAN NOT NULL DEFAULT true,
    "captureRoute" BOOLEAN NOT NULL DEFAULT false,
    "captureAirportFees" BOOLEAN NOT NULL DEFAULT true,
    "maxHobbsDeltaHours" DECIMAL(6,1) NOT NULL DEFAULT 15.0,
    "maxTachDeltaHours" DECIMAL(6,1) NOT NULL DEFAULT 15.0,
    "warnHobbsDeltaHours" DECIMAL(6,1) NOT NULL DEFAULT 8.0,
    "durationOverScheduleHours" DECIMAL(4,1) NOT NULL DEFAULT 2.0,
    "tachHobbsRatioMin" DECIMAL(4,2) NOT NULL DEFAULT 0.50,
    "tachHobbsRatioMax" DECIMAL(4,2) NOT NULL DEFAULT 1.10,
    "meterMismatchMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "unexpectedDurationMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "missingInstructorTimeMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "missingPayerMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "missingPaymentMethodMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "unexpectedFeeMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "maintenanceThresholdMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "hobbsOutDriftMode" "WarningMode" NOT NULL DEFAULT 'WARN',
    "concurrentReleaseMode" "WarningMode" NOT NULL DEFAULT 'BLOCK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutRestrictionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" "CheckoutRestrictionKey" NOT NULL,
    "enforcement" "RestrictionEnforcement" NOT NULL,
    "thresholdAmount" DECIMAL(12,2),
    "currency" CHAR(3),
    "thresholdHours" DECIMAL(6,1),
    "thresholdDays" INTEGER,
    "exemptOrgRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutRestrictionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgPaymentPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "defaultTimingPolicy" "PaymentTimingPolicy" NOT NULL DEFAULT 'IMMEDIATE_ON_APPROVAL',
    "overridePolicies" "PaymentTimingPolicy"[] DEFAULT ARRAY[]::"PaymentTimingPolicy"[],
    "sameDayBatchHourLocal" INTEGER NOT NULL DEFAULT 17,
    "nightlyBatchHourLocal" INTEGER NOT NULL DEFAULT 2,
    "weeklyBatchDay" INTEGER NOT NULL DEFAULT 1,
    "weeklyBatchHourLocal" INTEGER NOT NULL DEFAULT 2,
    "achBatchCadence" TEXT NOT NULL DEFAULT 'NIGHTLY',
    "achOnlyFallback" TEXT NOT NULL DEFAULT 'MANUAL_INVOICE',
    "customDateMaxDays" INTEGER NOT NULL DEFAULT 30,
    "manualInvoiceNetDays" INTEGER NOT NULL DEFAULT 14,
    "retryMode" TEXT NOT NULL DEFAULT 'MANUAL_ONLY',
    "maxAutoRetries" INTEGER NOT NULL DEFAULT 0,
    "autoRetryDelaysDays" INTEGER[] DEFAULT ARRAY[1, 3, 7]::INTEGER[],
    "approveWithoutMethod" TEXT NOT NULL DEFAULT 'WARN',
    "deferredPaymentAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPaymentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountingMapping" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalSystem" TEXT NOT NULL DEFAULT 'quickbooks',
    "sourceType" "MappingSourceType" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalAccount" TEXT NOT NULL,
    "externalClass" TEXT,
    "externalItem" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "timeRoundingMode" "TimeRoundingMode" NOT NULL DEFAULT 'TENTH',
    "minimumBillableIncrementHours" DECIMAL(4,2),
    "minimumGroundInstructionHours" DECIMAL(4,2),
    "defaultPreflightBriefingHours" DECIMAL(4,2) NOT NULL DEFAULT 0.3,
    "defaultPostflightDebriefingHours" DECIMAL(4,2) NOT NULL DEFAULT 0.2,
    "flightTimeSuggestionMode" "FlightTimeSuggestionMode" NOT NULL DEFAULT 'SUGGEST_CONFIRM',
    "maxHobbsDivergenceHours" DECIMAL(4,2) DEFAULT 0.5,
    "hobbsDivergenceAction" "HobbsDivergenceAction" NOT NULL DEFAULT 'WARN',
    "compensationUsesBilledQuantity" BOOLEAN NOT NULL DEFAULT true,
    "allowCompensationLinkedToBilling" BOOLEAN NOT NULL DEFAULT false,
    "allowRateSelfApproval" BOOLEAN NOT NULL DEFAULT true,
    "defaultBillingBasis" "PricingBillingBasis" NOT NULL DEFAULT 'HOBBS',
    "defaultRoundingRule" "PricingRoundingRule" NOT NULL DEFAULT 'NEAREST_TENTH',
    "pricingSeparationOfDuties" BOOLEAN NOT NULL DEFAULT false,
    "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
    "taxProvider" "TaxProvider" NOT NULL DEFAULT 'INTERNAL',
    "taxRoundingMode" "TaxRoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "taxRoundingLevel" "TaxRoundingLevel" NOT NULL DEFAULT 'PER_RULE_TOTAL',
    "taxRegistrationLabel" TEXT,
    "creditExpiryMonths" INTEGER NOT NULL DEFAULT 12,
    "autoApplyCredits" BOOLEAN NOT NULL DEFAULT true,
    "refundToCreditAllowed" BOOLEAN NOT NULL DEFAULT true,
    "instructorClawbackPolicy" "InstructorClawbackPolicy" NOT NULL DEFAULT 'SERVICE_LINES_ONLY',
    "promoCodesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "refundWarnAfterDays" INTEGER NOT NULL DEFAULT 90,
    "payerChargeApproval" "PayerChargeApprovalMode" NOT NULL DEFAULT 'OFF',
    "payerApprovalWindowDays" INTEGER NOT NULL DEFAULT 3,
    "adultStudentConsent" "AdultStudentConsentMode" NOT NULL DEFAULT 'ORG_AUTHORITY',
    "minorPayerPolicy" "MinorPayerPolicy" NOT NULL DEFAULT 'WARN',
    "payerInvitationExpiryDays" INTEGER NOT NULL DEFAULT 14,
    "billingAuthorizationVersion" TEXT NOT NULL DEFAULT 'v1',
    "payerNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discountAllocationMode" "DiscountAllocationMode" NOT NULL DEFAULT 'TARGET_CATEGORY',
    "compensationApprovalMode" "CompensationApprovalMode" NOT NULL DEFAULT 'AUTO_ON_REVIEW_APPROVAL',
    "compensationRefundPolicy" "CompensationRefundPolicy" NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    "reconciliationStalePaymentDays" INTEGER NOT NULL DEFAULT 5,
    "reconciliationUnmatchedPayoutDays" INTEGER NOT NULL DEFAULT 7,
    "defaultExportSystem" TEXT NOT NULL DEFAULT 'generic_csv',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgSequence_organizationId_key_key" ON "OrgSequence"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueWorkflowPolicy_organizationId_key" ON "RevenueWorkflowPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchPolicy_organizationId_key" ON "DispatchPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutRestrictionPolicy_organizationId_key_key" ON "CheckoutRestrictionPolicy"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPaymentPolicy_organizationId_key" ON "OrgPaymentPolicy"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingMapping_organizationId_externalSystem_sourceType__key" ON "AccountingMapping"("organizationId", "externalSystem", "sourceType", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueSettings_organizationId_key" ON "RevenueSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "OrgSequence" ADD CONSTRAINT "OrgSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueWorkflowPolicy" ADD CONSTRAINT "RevenueWorkflowPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchPolicy" ADD CONSTRAINT "DispatchPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutRestrictionPolicy" ADD CONSTRAINT "CheckoutRestrictionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPaymentPolicy" ADD CONSTRAINT "OrgPaymentPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingMapping" ADD CONSTRAINT "AccountingMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueSettings" ADD CONSTRAINT "RevenueSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
