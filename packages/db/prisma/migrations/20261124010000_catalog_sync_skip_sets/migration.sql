-- 2026-11-24: синхронізація каталогу може не переносити комплекти (лендінг goverla_landing їх не показує)
ALTER TABLE "CatalogSync" ADD COLUMN "skipSets" BOOLEAN NOT NULL DEFAULT false;
