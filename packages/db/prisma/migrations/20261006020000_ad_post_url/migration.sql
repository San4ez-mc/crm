-- Посилання на пост Instagram, який рекламується (Meta creative.instagram_permalink_url) — 2026-10-06: різні пости часто мають
-- однаковий початок підпису («Допис в Instagram: Чоловічий флісовий костюм...»), без посилання їх у звіті не розрізнити.
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "postUrl" TEXT;
