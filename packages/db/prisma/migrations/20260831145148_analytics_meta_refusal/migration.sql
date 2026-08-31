-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "adAccountId" TEXT,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "campaignName" TEXT;

-- AlterTable
ALTER TABLE "AdSpendDaily" ADD COLUMN     "clicks" INTEGER,
ADD COLUMN     "impressions" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isRefused" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "dailyFixedCosts" DECIMAL(12,2),
ADD COLUMN     "dailyPayrollCosts" DECIMAL(12,2),
ADD COLUMN     "usdExchangeRate" DECIMAL(10,4);
