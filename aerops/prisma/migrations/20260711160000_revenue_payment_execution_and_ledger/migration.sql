-- CreateEnum
CREATE TYPE "InstructorEarningStatus" AS ENUM ('PENDING', 'APPROVED', 'EXPORTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundDestination" AS ENUM ('ORIGINAL_METHOD', 'CUSTOMER_CREDIT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'WARNING_CLOSED');

-- CreateEnum
CREATE TYPE "ScheduledChargeStatus" AS ENUM ('SCHEDULED', 'AWAITING_MANUAL', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentAttemptTrigger" AS ENUM ('IMMEDIATE_ON_APPROVAL', 'BATCH', 'MANUAL', 'AUTO_RETRY');

-- CreateEnum
CREATE TYPE "AllocationEvent" AS ENUM ('APPROVAL', 'ADJUSTMENT', 'REFUND', 'VOID', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "AllocationDimension" AS ENUM ('REVENUE', 'PROCEEDS');

-- CreateEnum
CREATE TYPE "AllocationCategory" AS ENUM ('AIRCRAFT_REVENUE', 'INSTRUCTOR_SERVICE_REVENUE', 'AIRPORT_LANDING_FEES', 'FUEL_REVENUE', 'TAX', 'OTHER_REVENUE', 'PLATFORM_FEE', 'SCHOOL_RETAINED_REVENUE');

-- CreateEnum
CREATE TYPE "PlatformFeeBase" AS ENUM ('COLLECTED_PRETAX', 'COLLECTED_TOTAL');

-- CreateEnum
CREATE TYPE "PlatformFeeStatus" AS ENUM ('ACCRUED', 'EARNED', 'PARTIALLY_REVERSED', 'REVERSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('ACCOUNTS_RECEIVABLE', 'PAYMENT_CLEARING', 'CASH_ON_PREMISES', 'REVENUE_AIRCRAFT', 'REVENUE_INSTRUCTION', 'REVENUE_AIRPORT_FEES', 'REVENUE_FUEL', 'REVENUE_OTHER', 'CONTRA_REVENUE_DISCOUNTS', 'TAX_PAYABLE', 'PLATFORM_FEE_EXPENSE', 'PLATFORM_FEE_PAYABLE', 'INSTRUCTOR_COMP_EXPENSE', 'INSTRUCTOR_COMP_PAYABLE', 'PROCESSOR_FEES_EXPENSE', 'BAD_DEBT_EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'PAID', 'FAILED', 'RECONCILED', 'RECONCILED_WITH_EXCEPTIONS');

-- CreateEnum
CREATE TYPE "ReconciliationExceptionKind" AS ENUM ('MISSING_LOCAL_TRANSACTION', 'MISSING_PROVIDER_TRANSACTION', 'AMOUNT_MISMATCH', 'FEE_MISMATCH', 'UNBALANCED_JOURNAL', 'ALLOCATION_MISMATCH', 'STALE_PENDING_PAYMENT');

-- CreateEnum
CREATE TYPE "ReconciliationExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ConnectedAccountStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'REQUIREMENTS_DUE', 'RESTRICTED', 'ENABLED', 'DISABLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "FinancialHoldStatus" AS ENUM ('ACTIVE', 'LIFTED');

-- CreateEnum
CREATE TYPE "FinancialHoldSource" AS ENUM ('MANUAL', 'POLICY_ESCALATION');

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_invoiceId_fkey";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "currency" CHAR(3) NOT NULL DEFAULT 'USD',
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "paymentAttemptId" TEXT;

-- CreateTable
CREATE TABLE "InstructorEarning" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "revenueReviewId" TEXT NOT NULL,
    "timeEntryId" TEXT,
    "category" "InstructorTimeCategory" NOT NULL,
    "customLabel" TEXT,
    "hours" DECIMAL(6,2) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "classification" "InstructorClassification" NOT NULL,
    "rateProfileId" TEXT,
    "rateProfileVersion" INTEGER,
    "rateSource" JSONB,
    "status" "InstructorEarningStatus" NOT NULL DEFAULT 'PENDING',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "exportJobId" TEXT,
    "exportedAt" TIMESTAMP(3),
    "reversesEarningId" TEXT,
    "reversalReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstructorEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "adjustmentId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "destination" "RefundDestination" NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "issuedCreditId" TEXT,
    "failureReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "revenueReviewId" TEXT,
    "paymentId" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerDisputeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "evidenceDueBy" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledCharge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "revenueReviewId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "policy" "PaymentTimingPolicy" NOT NULL,
    "runAfter" TIMESTAMP(3),
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "paymentMethodReferenceId" TEXT,
    "status" "ScheduledChargeStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scheduledChargeId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerPaymentIntentId" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "trigger" "PaymentAttemptTrigger" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "methodType" "StoredPaymentMethodType",
    "methodBrand" TEXT,
    "methodLast4" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "initiatedByUserId" TEXT,
    "initiatedByLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "organizationId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueAllocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "revenueReviewId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "event" "AllocationEvent" NOT NULL,
    "dimension" "AllocationDimension" NOT NULL,
    "category" "AllocationCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFeePolicy" (
    "id" TEXT NOT NULL,
    "planId" TEXT,
    "organizationId" TEXT,
    "feePercentBps" INTEGER NOT NULL DEFAULT 0,
    "feeFlatAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "feeBase" "PlatformFeeBase" NOT NULL DEFAULT 'COLLECTED_PRETAX',
    "minFee" DECIMAL(12,2),
    "maxFee" DECIMAL(12,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "refundReversesFee" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFeePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "revenueReviewId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "PlatformFeeStatus" NOT NULL DEFAULT 'ACCRUED',
    "feePercentBps" INTEGER NOT NULL,
    "feeFlatAmount" DECIMAL(12,2) NOT NULL,
    "feeBase" "PlatformFeeBase" NOT NULL,
    "appliedBaseAmount" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reversedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "policyId" TEXT,
    "policyVersion" INTEGER,
    "providerRef" TEXT,
    "earnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPayout" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "providerPayoutId" TEXT NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "feesAmount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "arrivalDate" TIMESTAMP(3),
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationException" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ReconciliationExceptionKind" NOT NULL,
    "status" "ReconciliationExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "providerRef" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "payoutId" TEXT,
    "expectedAmount" DECIMAL(12,2),
    "actualAmount" DECIMAL(12,2),
    "currency" CHAR(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectedAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerAccountId" TEXT,
    "status" "ConnectedAccountStatus" NOT NULL DEFAULT 'PENDING',
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "requirementsDue" JSONB,
    "disabledReason" TEXT,
    "country" CHAR(2),
    "defaultCurrency" CHAR(3),
    "businessType" TEXT,
    "statementDescriptor" TEXT,
    "capabilities" JSONB,
    "providerStateAsOf" TIMESTAMP(3),
    "lastStatusSyncAt" TIMESTAMP(3),
    "termsVersion" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "termsAcceptedByUserId" TEXT,
    "termsAcceptedByLabel" TEXT,
    "onboardingInitiatedAt" TIMESTAMP(3),
    "onboardingInitiatedByUserId" TEXT,
    "onboardingInitiatedByLabel" TEXT,
    "firstEnabledAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "suspendedByLabel" TEXT,
    "deauthorizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialHold" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" "FinancialHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "FinancialHoldSource" NOT NULL,
    "reason" TEXT NOT NULL,
    "contextReviewIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "placedByUserId" TEXT,
    "placedByLabel" TEXT NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedByUserId" TEXT,
    "liftedByLabel" TEXT,
    "liftedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstructorEarning_timeEntryId_key" ON "InstructorEarning"("timeEntryId");

-- CreateIndex
CREATE INDEX "InstructorEarning_organizationId_instructorId_createdAt_idx" ON "InstructorEarning"("organizationId", "instructorId", "createdAt");

-- CreateIndex
CREATE INDEX "InstructorEarning_organizationId_status_idx" ON "InstructorEarning"("organizationId", "status");

-- CreateIndex
CREATE INDEX "InstructorEarning_organizationId_createdAt_idx" ON "InstructorEarning"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "InstructorEarning_revenueReviewId_idx" ON "InstructorEarning"("revenueReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_adjustmentId_key" ON "Refund"("adjustmentId");

-- CreateIndex
CREATE INDEX "Refund_organizationId_status_idx" ON "Refund"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE INDEX "Dispute_organizationId_status_idx" ON "Dispute"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_provider_providerDisputeId_key" ON "Dispute"("provider", "providerDisputeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledCharge_revenueReviewId_key" ON "ScheduledCharge"("revenueReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledCharge_invoiceId_key" ON "ScheduledCharge"("invoiceId");

-- CreateIndex
CREATE INDEX "ScheduledCharge_organizationId_status_runAfter_idx" ON "ScheduledCharge"("organizationId", "status", "runAfter");

-- CreateIndex
CREATE INDEX "ScheduledCharge_status_runAfter_idx" ON "ScheduledCharge"("status", "runAfter");

-- CreateIndex
CREATE INDEX "ScheduledCharge_organizationId_createdAt_idx" ON "ScheduledCharge"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentAttempt_organizationId_status_createdAt_idx" ON "PaymentAttempt"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_invoiceId_idx" ON "PaymentAttempt"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_scheduledChargeId_attemptNumber_key" ON "PaymentAttempt"("scheduledChargeId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_provider_providerPaymentIntentId_key" ON "PaymentAttempt"("provider", "providerPaymentIntentId");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_organizationId_receivedAt_idx" ON "PaymentProviderEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "PaymentProviderEvent_type_receivedAt_idx" ON "PaymentProviderEvent"("type", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_providerEventId_key" ON "PaymentProviderEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "RevenueAllocation_organizationId_category_effectiveAt_idx" ON "RevenueAllocation"("organizationId", "category", "effectiveAt");

-- CreateIndex
CREATE INDEX "RevenueAllocation_organizationId_effectiveAt_idx" ON "RevenueAllocation"("organizationId", "effectiveAt");

-- CreateIndex
CREATE INDEX "RevenueAllocation_revenueReviewId_idx" ON "RevenueAllocation"("revenueReviewId");

-- CreateIndex
CREATE INDEX "RevenueAllocation_invoiceId_idx" ON "RevenueAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueAllocation_setId_dimension_category_key" ON "RevenueAllocation"("setId", "dimension", "category");

-- CreateIndex
CREATE INDEX "PlatformFeePolicy_organizationId_effectiveFrom_idx" ON "PlatformFeePolicy"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PlatformFeePolicy_planId_idx" ON "PlatformFeePolicy"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformFee_revenueReviewId_key" ON "PlatformFee"("revenueReviewId");

-- CreateIndex
CREATE INDEX "PlatformFee_organizationId_status_idx" ON "PlatformFee"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PlatformFee_organizationId_createdAt_idx" ON "PlatformFee"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_account_effectiveAt_idx" ON "LedgerEntry"("organizationId", "account", "effectiveAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_organizationId_journalId_idx" ON "LedgerEntry"("organizationId", "journalId");

-- CreateIndex
CREATE INDEX "LedgerEntry_sourceType_sourceId_idx" ON "LedgerEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ProviderPayout_organizationId_status_idx" ON "ProviderPayout"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPayout_organizationId_provider_providerPayoutId_key" ON "ProviderPayout"("organizationId", "provider", "providerPayoutId");

-- CreateIndex
CREATE INDEX "ReconciliationException_organizationId_status_idx" ON "ReconciliationException"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ReconciliationException_organizationId_kind_detectedAt_idx" ON "ReconciliationException"("organizationId", "kind", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_organizationId_key" ON "ConnectedAccount"("organizationId");

-- CreateIndex
CREATE INDEX "ConnectedAccount_status_lastStatusSyncAt_idx" ON "ConnectedAccount"("status", "lastStatusSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectedAccount_provider_providerAccountId_key" ON "ConnectedAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "FinancialHold_organizationId_status_idx" ON "FinancialHold"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FinancialHold_organizationId_studentId_createdAt_idx" ON "FinancialHold"("organizationId", "studentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentAttemptId_key" ON "Payment"("paymentAttemptId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_paidAt_idx" ON "Payment"("organizationId", "paidAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorEarning" ADD CONSTRAINT "InstructorEarning_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorEarning" ADD CONSTRAINT "InstructorEarning_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorEarning" ADD CONSTRAINT "InstructorEarning_revenueReviewId_fkey" FOREIGN KEY ("revenueReviewId") REFERENCES "RevenueReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorEarning" ADD CONSTRAINT "InstructorEarning_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "InstructorTimeEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorEarning" ADD CONSTRAINT "InstructorEarning_rateProfileId_fkey" FOREIGN KEY ("rateProfileId") REFERENCES "InstructorRateProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorEarning" ADD CONSTRAINT "InstructorEarning_reversesEarningId_fkey" FOREIGN KEY ("reversesEarningId") REFERENCES "InstructorEarning"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_revenueReviewId_fkey" FOREIGN KEY ("revenueReviewId") REFERENCES "RevenueReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCharge" ADD CONSTRAINT "ScheduledCharge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCharge" ADD CONSTRAINT "ScheduledCharge_revenueReviewId_fkey" FOREIGN KEY ("revenueReviewId") REFERENCES "RevenueReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCharge" ADD CONSTRAINT "ScheduledCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledCharge" ADD CONSTRAINT "ScheduledCharge_paymentMethodReferenceId_fkey" FOREIGN KEY ("paymentMethodReferenceId") REFERENCES "PaymentMethodReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_scheduledChargeId_fkey" FOREIGN KEY ("scheduledChargeId") REFERENCES "ScheduledCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAllocation" ADD CONSTRAINT "RevenueAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAllocation" ADD CONSTRAINT "RevenueAllocation_revenueReviewId_fkey" FOREIGN KEY ("revenueReviewId") REFERENCES "RevenueReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueAllocation" ADD CONSTRAINT "RevenueAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFeePolicy" ADD CONSTRAINT "PlatformFeePolicy_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFeePolicy" ADD CONSTRAINT "PlatformFeePolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFee" ADD CONSTRAINT "PlatformFee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFee" ADD CONSTRAINT "PlatformFee_revenueReviewId_fkey" FOREIGN KEY ("revenueReviewId") REFERENCES "RevenueReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFee" ADD CONSTRAINT "PlatformFee_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformFee" ADD CONSTRAINT "PlatformFee_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "PlatformFeePolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPayout" ADD CONSTRAINT "ProviderPayout_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationException" ADD CONSTRAINT "ReconciliationException_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectedAccount" ADD CONSTRAINT "ConnectedAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialHold" ADD CONSTRAINT "FinancialHold_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialHold" ADD CONSTRAINT "FinancialHold_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Raw-SQL partial unique (doc 34 §4.6 / R-P16; schema-governance allowlist).
-- Enforces at most one ACTIVE FinancialHold per student; LIFTED rows are
-- unconstrained (audit-shaped history). Prisma cannot express partial uniques.
CREATE UNIQUE INDEX "FinancialHold_active_key" ON "FinancialHold"("studentId") WHERE status = 'ACTIVE';
