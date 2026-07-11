-- DropIndex
DROP INDEX "RevenueReviewApproval_revenueReviewId_kind_key";

-- AlterTable
ALTER TABLE "RevenueReviewApproval" ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RevenueReviewApproval_revenueReviewId_kind_idx" ON "RevenueReviewApproval"("revenueReviewId", "kind");

-- One ACTIVE approval per (review, kind); superseded rows do not conflict (doc 03 §2.7).
CREATE UNIQUE INDEX "RevenueReviewApproval_active_kind_key" ON "RevenueReviewApproval"("revenueReviewId", "kind") WHERE "supersededAt" IS NULL;
