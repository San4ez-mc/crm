-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isSet" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "aiNotes" TEXT,
ADD COLUMN     "description" TEXT;
