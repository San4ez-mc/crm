-- 2026-11-14: ЗП менеджерів автоматично, % від маржі з прогнозованими відмовами (Щоденна аналітика)
ALTER TABLE "Tenant" ADD COLUMN "dailyPayrollPct" DECIMAL(5,2);
