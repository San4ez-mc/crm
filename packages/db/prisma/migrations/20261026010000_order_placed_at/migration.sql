-- Дата оформлення замовлення і хто оформив (2026-10-26, Edits c4fc2dcd/15b533ae) + очікувані відмови для звіту реклами (537c402a).
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "placedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "placedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Order_tenantId_placedAt_idx" ON "Order"("tenantId", "placedAt");
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "expectedRefusalPct" DECIMAL(5,2);
-- Початкове заповнення: замовлення (є покупець) — дата створення; уточнення для замовлень із розмов — scripts/backfill-placed-at.js.
UPDATE "Order" SET "placedAt" = "createdAt" WHERE "buyerId" IS NOT NULL AND "placedAt" IS NULL;
