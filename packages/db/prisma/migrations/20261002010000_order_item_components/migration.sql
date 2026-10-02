-- Склад комплекту в позиції замовлення (колір/розмір кожної речі) + коли менеджер змінив позиції чи доставку (2026-10-02).
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "components" JSONB;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "managerEditedAt" TIMESTAMP(3);
