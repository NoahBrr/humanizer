-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIVE', 'TRANSFER', 'INSTALL', 'REMOVE', 'RETURN', 'SCRAP', 'WARRANTY', 'ADJUSTMENT', 'LOST', 'DAMAGED', 'AUDIT');

-- CreateTable
CREATE TABLE "Part" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partNumber" TEXT NOT NULL,
    "manufacturer" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Consumable',
    "condition" TEXT NOT NULL DEFAULT 'NEW',
    "unitCost" DECIMAL(10,2),
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 0,
    "maxQuantity" INTEGER,
    "location" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Part_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "workOrderId" TEXT,
    "aircraftId" TEXT,
    "notes" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Part_organizationId_category_idx" ON "Part"("organizationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Part_organizationId_partNumber_key" ON "Part"("organizationId", "partNumber");

-- CreateIndex
CREATE INDEX "InventoryMovement_partId_createdAt_idx" ON "InventoryMovement"("partId", "createdAt");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
