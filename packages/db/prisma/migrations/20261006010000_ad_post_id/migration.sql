-- Пост Instagram/Facebook, який рекламує оголошення (Meta creative.effective_object_story_id) — 2026-10-06, Edit 71b501a3:
-- кожне «Просувати допис» створює окрему кампанію/оголошення; без postId звіт показував той самий пост 26 разів.
ALTER TABLE "Ad" ADD COLUMN IF NOT EXISTS "postId" TEXT;
CREATE INDEX IF NOT EXISTS "Ad_tenantId_postId_idx" ON "Ad"("tenantId", "postId");
