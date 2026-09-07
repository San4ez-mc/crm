-- AlterTable
ALTER TABLE "ProductExpense" ADD COLUMN     "cogsHistory" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "usdExchangeRateUpdatedAt" TIMESTAMP(3);
