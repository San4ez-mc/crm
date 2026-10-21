-- Умови й тип магазину для бота — у налаштуваннях магазину (2026-10-21).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "shopDescription" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "prepaymentAmount" DECIMAL(12,2);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "shippingTerms" TEXT;
