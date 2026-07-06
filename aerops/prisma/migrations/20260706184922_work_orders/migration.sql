-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL', 'AOG', 'EMERGENCY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MaintenanceStatus" ADD VALUE 'DRAFT';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'OPEN';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'WAITING_PARTS';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'AWAITING_INSPECTION';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'APPROVED';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'RETURN_TO_SERVICE';
ALTER TYPE "MaintenanceStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "MaintenanceOrder" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "correctiveAction" TEXT,
ADD COLUMN     "estimatedCompletion" TIMESTAMP(3),
ADD COLUMN     "laborHours" DECIMAL(6,1),
ADD COLUMN     "number" TEXT,
ADD COLUMN     "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL';
