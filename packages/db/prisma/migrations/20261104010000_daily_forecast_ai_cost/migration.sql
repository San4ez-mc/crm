-- Прогноз відмов/повернень у «Щоденній аналітиці» і вартість ШІ-бота в розмові (2026-11-04, Edits Олексія 03.11).
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "forecastRefusalPct" DECIMAL(5,2);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "forecastReturnPct" DECIMAL(5,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "aiCostUsd" DECIMAL(12,6);
CREATE TABLE IF NOT EXISTS "DayForecast" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "refusalPct" DECIMAL(5,2),
    "returnPct" DECIMAL(5,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DayForecast_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DayForecast_tenantId_date_key" ON "DayForecast"("tenantId", "date");
ALTER TABLE "DayForecast" ADD CONSTRAINT "DayForecast_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
