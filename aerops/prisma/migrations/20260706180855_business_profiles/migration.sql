-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "businessProfiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "disabledAutomations" TEXT[] DEFAULT ARRAY[]::TEXT[];
