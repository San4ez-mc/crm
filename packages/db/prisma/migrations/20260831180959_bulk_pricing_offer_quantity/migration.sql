-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "quantity" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "bulkPricing" JSONB NOT NULL DEFAULT '[]';
