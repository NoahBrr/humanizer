-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('LEAD', 'DISCOVERY_FLIGHT', 'PROSPECT', 'ENROLLED', 'GRADUATE', 'ALUMNI', 'INACTIVE');

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "discoveryFlightAt" TIMESTAMP(3),
ADD COLUMN     "discoveryOutcome" TEXT,
ADD COLUMN     "faaCertificateNumber" TEXT,
ADD COLUMN     "ftnNumber" TEXT,
ADD COLUMN     "leadSource" TEXT,
ADD COLUMN     "status" "StudentStatus" NOT NULL DEFAULT 'ENROLLED',
ADD COLUMN     "writtenTestDate" TIMESTAMP(3),
ADD COLUMN     "writtenTestPassed" BOOLEAN,
ADD COLUMN     "writtenTestScore" INTEGER;
