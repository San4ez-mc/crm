-- 2026-11-11: власні показники «Щоденної аналітики»: розкладка, шаблони, ручні значення по днях
ALTER TABLE "Tenant" ADD COLUMN "dailyLayout" JSONB;
ALTER TABLE "Tenant" ADD COLUMN "dailyTemplates" JSONB NOT NULL DEFAULT '[]';

CREATE TABLE "DayCustomValue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DayCustomValue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DayCustomValue_tenantId_rowId_date_key" ON "DayCustomValue"("tenantId", "rowId", "date");
CREATE INDEX "DayCustomValue_tenantId_rowId_idx" ON "DayCustomValue"("tenantId", "rowId");
ALTER TABLE "DayCustomValue" ADD CONSTRAINT "DayCustomValue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
