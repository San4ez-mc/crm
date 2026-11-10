-- 2026-11-10: синхронізація каталогу між магазинами (джерело → приймач)
ALTER TABLE "Category" ADD COLUMN "syncSourceId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "syncSourceId" TEXT;
ALTER TABLE "Product" ADD COLUMN "syncSourceId" TEXT;
ALTER TABLE "Offer" ADD COLUMN "syncSourceId" TEXT;
CREATE INDEX "Product_tenantId_syncSourceId_idx" ON "Product"("tenantId", "syncSourceId");

CREATE TABLE "CatalogSync" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceTenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncCosts" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogSync_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogSync_tenantId_key" ON "CatalogSync"("tenantId");
ALTER TABLE "CatalogSync" ADD CONSTRAINT "CatalogSync_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
