-- Повернення з бота (2026-10-03): ТТН зворотної посилки і на що обміняти (для обміну).
ALTER TABLE "Return" ADD COLUMN IF NOT EXISTS "ttn" TEXT;
ALTER TABLE "Return" ADD COLUMN IF NOT EXISTS "exchangeFor" TEXT;
ALTER TABLE "Return" ADD COLUMN IF NOT EXISTS "source" TEXT;
