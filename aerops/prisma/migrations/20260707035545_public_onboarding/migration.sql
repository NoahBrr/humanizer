-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MORE_INFO', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "organizationId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "JoinRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedRole" "Role" NOT NULL DEFAULT 'STUDENT',
    "phone" TEXT,
    "certificateInfo" TEXT,
    "reason" TEXT,
    "message" TEXT,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "adminResponse" TEXT,
    "assignedRole" "Role",
    "assignedLocationId" TEXT,
    "decidedByLabel" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'General invite',
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'demo',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "orgType" TEXT,
    "fleetSize" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JoinRequest_organizationId_status_idx" ON "JoinRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JoinRequest_userId_status_idx" ON "JoinRequest"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InviteLink_token_key" ON "InviteLink"("token");

-- CreateIndex
CREATE INDEX "InviteLink_organizationId_idx" ON "InviteLink"("organizationId");

-- CreateIndex
CREATE INDEX "DemoRequest_createdAt_idx" ON "DemoRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoinRequest" ADD CONSTRAINT "JoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteLink" ADD CONSTRAINT "InviteLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
