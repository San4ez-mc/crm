-- Товар повністю відсутній (2026-10-03): бот не пропонує його і прибирає з комплектів.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "outOfStock" BOOLEAN NOT NULL DEFAULT false;
