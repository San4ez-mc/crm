-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "requiredParams" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "funnelSlug" TEXT,
    "sessionId" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "stageOrder" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FunnelEvent_tenantId_funnelSlug_idx" ON "FunnelEvent"("tenantId", "funnelSlug");

-- CreateIndex
CREATE INDEX "FunnelEvent_tenantId_stageName_idx" ON "FunnelEvent"("tenantId", "stageName");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEvent_tenantId_sessionId_stageName_key" ON "FunnelEvent"("tenantId", "sessionId", "stageName");

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
