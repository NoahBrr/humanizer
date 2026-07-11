-- CreateEnum
CREATE TYPE "RevenueReviewStatus" AS ENUM ('DRAFT', 'AWAITING_INSTRUCTOR_REVIEW', 'AWAITING_OPERATIONS_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PAYMENT_SCHEDULED', 'PAYMENT_PROCESSING', 'CARD_PAID', 'ACH_PENDING', 'PAID', 'PAYMENT_FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'DISPUTED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "RevenueApprovalKind" AS ENUM ('INSTRUCTOR_ROUTINE', 'OPERATIONS', 'SECOND', 'FINANCE');

-- CreateEnum
CREATE TYPE "InstructorTimeSource" AS ENUM ('INSTRUCTOR_ENTERED', 'HOBBS_SUGGESTED', 'SUPERVISOR_ENTERED', 'SUPERVISOR_OVERRIDE');

-- CreateTable
CREATE TABLE "RevenueReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "RevenueReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "invoiceId" TEXT NOT NULL,
    "dispatchId" TEXT,
    "aircraftId" TEXT,
    "studentId" TEXT,
    "instructorId" TEXT,
    "locationId" TEXT,
    "payerId" TEXT,
    "payerResolutionBasis" TEXT,
    "billToLabel" TEXT,
    "billToPayerType" "PayerType",
    "paymentMethodRefId" TEXT,
    "payerApprovalRequestedAt" TIMESTAMP(3),
    "payerApprovedAt" TIMESTAMP(3),
    "payerDeclinedAt" TIMESTAMP(3),
    "payerDeclineReason" TEXT,
    "flightDate" TIMESTAMP(3),
    "hobbsOut" DECIMAL(9,1),
    "hobbsIn" DECIMAL(9,1),
    "tachOut" DECIMAL(9,1),
    "tachIn" DECIMAL(9,1),
    "flightTime" DECIMAL(6,1),
    "landings" INTEGER,
    "warnings" JSONB,
    "riskFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secondApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "changesRequestedAt" TIMESTAMP(3),
    "changesRequestedById" TEXT,
    "changesRequestedReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvalSnapshot" JSONB,
    "totalAtApproval" DECIMAL(12,2),
    "paymentPolicyAtApproval" "PaymentTimingPolicy",
    "scheduledChargeAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueReviewApproval" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "revenueReviewId" TEXT NOT NULL,
    "kind" "RevenueApprovalKind" NOT NULL,
    "approverUserId" TEXT,
    "approverLabel" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueReviewApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstructorTimeEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "revenueReviewId" TEXT NOT NULL,
    "instructorId" TEXT NOT NULL,
    "scheduleEventId" TEXT,
    "category" "InstructorTimeCategory" NOT NULL,
    "customLabel" TEXT,
    "hours" DECIMAL(6,2) NOT NULL,
    "suggestedHours" DECIMAL(6,2),
    "source" "InstructorTimeSource" NOT NULL,
    "billToCustomer" BOOLEAN NOT NULL,
    "compensable" BOOLEAN NOT NULL,
    "notes" TEXT,
    "confirmedByInstructorAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "overriddenById" TEXT,
    "overriddenByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstructorTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RevenueReview_invoiceId_key" ON "RevenueReview"("invoiceId");

-- CreateIndex
CREATE INDEX "RevenueReview_organizationId_status_idx" ON "RevenueReview"("organizationId", "status");

-- CreateIndex
CREATE INDEX "RevenueReview_organizationId_createdAt_idx" ON "RevenueReview"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "RevenueReview_organizationId_status_scheduledChargeAt_idx" ON "RevenueReview"("organizationId", "status", "scheduledChargeAt");

-- CreateIndex
CREATE INDEX "RevenueReview_instructorId_status_idx" ON "RevenueReview"("instructorId", "status");

-- CreateIndex
CREATE INDEX "RevenueReview_dispatchId_idx" ON "RevenueReview"("dispatchId");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueReview_organizationId_number_key" ON "RevenueReview"("organizationId", "number");

-- CreateIndex
CREATE INDEX "RevenueReviewApproval_organizationId_createdAt_idx" ON "RevenueReviewApproval"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RevenueReviewApproval_revenueReviewId_kind_key" ON "RevenueReviewApproval"("revenueReviewId", "kind");

-- CreateIndex
CREATE INDEX "InstructorTimeEntry_organizationId_createdAt_idx" ON "InstructorTimeEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "InstructorTimeEntry_revenueReviewId_idx" ON "InstructorTimeEntry"("revenueReviewId");

-- CreateIndex
CREATE INDEX "InstructorTimeEntry_instructorId_createdAt_idx" ON "InstructorTimeEntry"("instructorId", "createdAt");

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "ResponsiblePayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReviewApproval" ADD CONSTRAINT "RevenueReviewApproval_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReviewApproval" ADD CONSTRAINT "RevenueReviewApproval_revenueReviewId_fkey" FOREIGN KEY ("revenueReviewId") REFERENCES "RevenueReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevenueReviewApproval" ADD CONSTRAINT "RevenueReviewApproval_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorTimeEntry" ADD CONSTRAINT "InstructorTimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorTimeEntry" ADD CONSTRAINT "InstructorTimeEntry_revenueReviewId_fkey" FOREIGN KEY ("revenueReviewId") REFERENCES "RevenueReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorTimeEntry" ADD CONSTRAINT "InstructorTimeEntry_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "Instructor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstructorTimeEntry" ADD CONSTRAINT "InstructorTimeEntry_scheduleEventId_fkey" FOREIGN KEY ("scheduleEventId") REFERENCES "ScheduleEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique: at most one active (non-VOIDED) RevenueReview per dispatch (Prisma cannot express partial indexes)
CREATE UNIQUE INDEX "RevenueReview_dispatch_active_key" ON "RevenueReview"("dispatchId") WHERE status <> 'VOIDED';
