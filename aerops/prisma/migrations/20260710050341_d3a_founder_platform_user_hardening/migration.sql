-- AlterEnum
ALTER TYPE "PlatformRole" ADD VALUE 'FOUNDER_SUPER_ADMIN';

-- AlterTable
ALTER TABLE "PlatformUser" ADD COLUMN     "accessExpiresAt" TIMESTAMP(3),
ADD COLUMN     "accessStartsAt" TIMESTAMP(3),
ADD COLUMN     "customRoleId" TEXT,
ADD COLUMN     "invitedByLabel" TEXT,
ADD COLUMN     "isFounder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "readOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restrictedOrgIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "PlatformCustomRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdByLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUserInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "customRoleId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedByLabel" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformUserInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCustomRole_name_key" ON "PlatformCustomRole"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUserInvitation_tokenHash_key" ON "PlatformUserInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformUserInvitation_email_idx" ON "PlatformUserInvitation"("email");

-- CreateIndex
CREATE INDEX "PlatformUserInvitation_customRoleId_idx" ON "PlatformUserInvitation"("customRoleId");

-- CreateIndex
CREATE INDEX "PlatformUser_customRoleId_idx" ON "PlatformUser"("customRoleId");

-- AddForeignKey
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "PlatformCustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformUserInvitation" ADD CONSTRAINT "PlatformUserInvitation_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "PlatformCustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
