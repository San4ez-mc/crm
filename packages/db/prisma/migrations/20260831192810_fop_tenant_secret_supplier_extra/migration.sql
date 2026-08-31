-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "loginPassword" TEXT,
ADD COLUMN     "loginUsername" TEXT,
ADD COLUMN     "telegramGroupId" TEXT,
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "Fop" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "iban" TEXT,
    "taxId" TEXT,
    "monobankToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSecret" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT true,
    "syncedToFunnelAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fop_tenantId_idx" ON "Fop"("tenantId");

-- CreateIndex
CREATE INDEX "TenantSecret_tenantId_idx" ON "TenantSecret"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSecret_tenantId_key_key" ON "TenantSecret"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "Fop" ADD CONSTRAINT "Fop_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSecret" ADD CONSTRAINT "TenantSecret_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
