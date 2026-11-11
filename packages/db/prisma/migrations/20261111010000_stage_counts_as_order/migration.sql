-- 2026-11-11: замовленням у звітах є картка зі стадії «Замовлення прийняте» й далі; ранні стадії (презентація, чекаємо дані й оплату) — ні
ALTER TABLE "Stage" ADD COLUMN "countsAsOrder" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Stage" s SET "countsAsOrder" = false
WHERE EXISTS (
  SELECT 1 FROM "Stage" a
  WHERE a."pipelineId" = s."pipelineId" AND lower(a."name") LIKE '%прийнят%' AND a."order" > s."order"
);
