-- Спосіб оплати замовлення (часткова/повна передплата, накладений платіж) + постачальник позиції замовлення (2026-10-18).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "paymentType" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "prepaymentAmount" DECIMAL(12,2);
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
CREATE INDEX IF NOT EXISTS "OrderItem_supplierId_idx" ON "OrderItem"("supplierId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
