-- Відкритий ключ магазину для форми замовлення на лендінгу (лише створення замовлення).
ALTER TABLE "Tenant" ADD COLUMN "publicKey" TEXT;
CREATE UNIQUE INDEX "Tenant_publicKey_key" ON "Tenant"("publicKey");
