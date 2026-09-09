-- AlterTable: картка замовлення на кожну розмову воронки (2026-09-09)
ALTER TABLE "Order" ADD COLUMN     "funnelSessionId" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactIg" TEXT,
ADD COLUMN     "lastClientAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_tenantId_funnelSessionId_idx" ON "Order"("tenantId", "funnelSessionId");
