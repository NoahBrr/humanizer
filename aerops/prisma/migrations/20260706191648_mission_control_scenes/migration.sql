-- CreateTable
CREATE TABLE "MissionControlScene" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "panels" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionControlScene_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionControlScene_organizationId_idx" ON "MissionControlScene"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionControlScene_organizationId_name_key" ON "MissionControlScene"("organizationId", "name");
