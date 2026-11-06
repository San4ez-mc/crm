-- 2026-11-06 (Edits Олексія): м'яке видалення замовлень + ручні витрати/курс по днях.
ALTER TABLE "Order" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "deletedBy" TEXT;
CREATE INDEX "Order_tenantId_deletedAt_idx" ON "Order"("tenantId", "deletedAt");

ALTER TABLE "DayForecast" ADD COLUMN "fixedCosts" DECIMAL(12,2);
ALTER TABLE "DayForecast" ADD COLUMN "payrollCosts" DECIMAL(12,2);
ALTER TABLE "DayForecast" ADD COLUMN "usdRate" DECIMAL(10,4);

-- Тарифи, оплата підписки (WayForPay), підказки-тури (2026-11-06)
ALTER TABLE "Tenant" ADD COLUMN "plan" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "planEndsAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "BillingPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "companyName" TEXT,
    "plan" TEXT NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "amountUsd" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "orderReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerStatus" TEXT,
    "providerPayload" JSONB,
    "newTenantId" TEXT,
    "paidAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingPayment_orderReference_key" ON "BillingPayment"("orderReference");
CREATE INDEX "BillingPayment_tenantId_idx" ON "BillingPayment"("tenantId");
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "UserTour" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tourKey" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserTour_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserTour_userId_tourKey_key" ON "UserTour"("userId", "tourKey");
