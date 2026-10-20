-- Статуси Нової пошти опитує сама CRM (2026-10-20): коли востаннє питали + очікувана дата доставки.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ttnStatusAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ttnEta" TIMESTAMP(3);
