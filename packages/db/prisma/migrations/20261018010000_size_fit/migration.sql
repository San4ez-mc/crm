-- 2026-10-18: розміри як дані — сітка підбору за зростом/вагою (fitChart) і межі від експерта (sizeRules) однаково в категоріях і
-- товарах; категорії — ще й картинка/таблиця замірів для товарів без власних.
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "fitChart" JSONB;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sizeRules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sizeChartImage" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sizeChartData" JSONB;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "fitChart" JSONB;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeRules" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "fitChart" JSONB;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "sizeRules" JSONB NOT NULL DEFAULT '[]';
