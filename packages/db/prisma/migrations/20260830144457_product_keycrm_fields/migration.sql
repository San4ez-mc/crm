-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aiNotes" TEXT,
ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sizeChartData" JSONB,
ADD COLUMN     "thumbnailUrl" TEXT;
