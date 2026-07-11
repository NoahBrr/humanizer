-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE');

-- CreateEnum
CREATE TYPE "StoredPaymentMethodType" AS ENUM ('CARD', 'US_BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "StoredPaymentMethodStatus" AS ENUM ('ACTIVE', 'REQUIRES_VERIFICATION', 'SUSPENDED', 'DETACHED');

-- CreateEnum
CREATE TYPE "PaymentConsentChannel" AS ENUM ('METHOD_SETUP', 'RE_ACCEPTANCE');

-- CreateTable
CREATE TABLE "PaymentCustomer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerCustomerId" TEXT NOT NULL,
    "payerId" TEXT,
    "studentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethodReference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentCustomerId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerPaymentMethodId" TEXT NOT NULL,
    "type" "StoredPaymentMethodType" NOT NULL,
    "status" "StoredPaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "brand" TEXT,
    "last4" TEXT,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "bankName" TEXT,
    "fingerprint" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "detachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethodReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentCustomerId" TEXT NOT NULL,
    "payerId" TEXT,
    "studentId" TEXT,
    "paymentMethodReferenceId" TEXT,
    "methodType" "StoredPaymentMethodType",
    "methodBrand" TEXT,
    "methodLast4" TEXT,
    "consentVersion" TEXT NOT NULL,
    "consentTextHash" TEXT NOT NULL,
    "channel" "PaymentConsentChannel" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedByUserId" TEXT,
    "acceptedByLabel" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
    "providerSetupIntentId" TEXT,
    "providerMandateRef" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedByLabel" TEXT,
    "revokedReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentCustomer_organizationId_idx" ON "PaymentCustomer"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCustomer_organizationId_provider_providerCustomerId_key" ON "PaymentCustomer"("organizationId", "provider", "providerCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCustomer_organizationId_payerId_key" ON "PaymentCustomer"("organizationId", "payerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCustomer_organizationId_studentId_key" ON "PaymentCustomer"("organizationId", "studentId");

-- CreateIndex
CREATE INDEX "PaymentMethodReference_paymentCustomerId_status_idx" ON "PaymentMethodReference"("paymentCustomerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodReference_organizationId_provider_providerPaym_key" ON "PaymentMethodReference"("organizationId", "provider", "providerPaymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentConsent_paymentMethodReferenceId_revokedAt_idx" ON "PaymentConsent"("paymentMethodReferenceId", "revokedAt");

-- CreateIndex
CREATE INDEX "PaymentConsent_organizationId_paymentCustomerId_idx" ON "PaymentConsent"("organizationId", "paymentCustomerId");

-- CreateIndex
CREATE INDEX "PaymentConsent_organizationId_createdAt_idx" ON "PaymentConsent"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConsent_provider_providerSetupIntentId_key" ON "PaymentConsent"("provider", "providerSetupIntentId");

-- AddForeignKey
ALTER TABLE "RevenueReview" ADD CONSTRAINT "RevenueReview_paymentMethodRefId_fkey" FOREIGN KEY ("paymentMethodRefId") REFERENCES "PaymentMethodReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCustomer" ADD CONSTRAINT "PaymentCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCustomer" ADD CONSTRAINT "PaymentCustomer_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "ResponsiblePayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCustomer" ADD CONSTRAINT "PaymentCustomer_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethodReference" ADD CONSTRAINT "PaymentMethodReference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethodReference" ADD CONSTRAINT "PaymentMethodReference_paymentCustomerId_fkey" FOREIGN KEY ("paymentCustomerId") REFERENCES "PaymentCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConsent" ADD CONSTRAINT "PaymentConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConsent" ADD CONSTRAINT "PaymentConsent_paymentCustomerId_fkey" FOREIGN KEY ("paymentCustomerId") REFERENCES "PaymentCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConsent" ADD CONSTRAINT "PaymentConsent_paymentMethodReferenceId_fkey" FOREIGN KEY ("paymentMethodReferenceId") REFERENCES "PaymentMethodReference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
