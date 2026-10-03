-- Розмови, які почала реклама за день (Meta messaging_conversation_started) — вага «що зараз рекламується» для бота (2026-10-03).
ALTER TABLE "AdSpendDaily" ADD COLUMN IF NOT EXISTS "conversations" INTEGER;
