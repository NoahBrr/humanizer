-- CreateTable
CREATE TABLE "PlatformNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorLabel" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformNote_organizationId_createdAt_idx" ON "PlatformNote"("organizationId", "createdAt");
