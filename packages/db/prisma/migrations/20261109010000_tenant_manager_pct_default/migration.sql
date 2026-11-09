-- 2026-11-09: загальний % ЗП менеджера (від націнки) для товарів без власного %
ALTER TABLE "Tenant" ADD COLUMN "managerCostPercentDefault" DECIMAL(5,2);
