-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('SCHOOL_OWNED', 'LEASEBACK', 'RENTAL', 'PARTNER_OWNED', 'PRIVATE_OWNER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SquawkStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "SquawkStatus" ADD VALUE 'WAITING_PARTS';
ALTER TYPE "SquawkStatus" ADD VALUE 'TESTING';
ALTER TYPE "SquawkStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "Aircraft" ADD COLUMN     "cruiseSpeedKts" INTEGER,
ADD COLUMN     "emptyWeightLbs" INTEGER,
ADD COLUMN     "engineModel" TEXT,
ADD COLUMN     "engineSerial" TEXT,
ADD COLUMN     "estimatedHourlyCost" DECIMAL(8,2),
ADD COLUMN     "fuelCapacityGal" INTEGER,
ADD COLUMN     "fuelSurchargePerHr" DECIMAL(6,2),
ADD COLUMN     "insuranceCostMonthly" DECIMAL(8,2),
ADD COLUMN     "maxGrossWeightLbs" INTEGER,
ADD COLUMN     "nickname" TEXT,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "ownershipType" "OwnershipType" NOT NULL DEFAULT 'SCHOOL_OWNED',
ADD COLUMN     "propManufacturer" TEXT,
ADD COLUMN     "propSerial" TEXT,
ADD COLUMN     "serialNumber" TEXT;

-- AlterTable
ALTER TABLE "Squawk" ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "category" TEXT;
