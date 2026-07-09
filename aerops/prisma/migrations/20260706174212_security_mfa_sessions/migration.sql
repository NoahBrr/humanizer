-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "PlatformUser" ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaSecret" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaSecret" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "platformUserId" TEXT,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginEvent_organizationId_createdAt_idx" ON "LoginEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_email_createdAt_idx" ON "LoginEvent"("email", "createdAt");
