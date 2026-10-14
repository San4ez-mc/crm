-- Варіант Advantage+ («_Group_1» з рефералу розмови) → справжнє оголошення (lib/adVariants.js), 2026-10-14.
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "variantOfAdId" TEXT;
CREATE INDEX IF NOT EXISTS "Ad_tenantId_variantOfAdId_idx" ON "Ad"("tenantId", "variantOfAdId");
