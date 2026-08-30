#!/usr/bin/env node
// Одноразова міграція каталогу з KeyCRM у Fineko CRM (§2 ТЗ: "Мігрувати каталог KeyCRM —
// так, повністю — товари, кастомні поля, ціни один раз переносяться скриптом-міграцією").
//
// СТАТУС: скелет. Реальний виклик KeyCRM API (auth, ендпойнт списку товарів, пагінація)
// ще не підключений — тут немає доступу до облікових даних KeyCRM з цього середовища.
// Що вже готово: повний мапінг полів (§4.2 таблиця "Було в KeyCRM") у нашу модель,
// ідемпотентний upsert за sku, dry-run режим. Щоб доробити:
//   1. Замінити loadFromKeyCrmApi() на реальний виклик (креденшели — в .env, НЕ в коді).
//   2. Прогнати спершу з --dry-run, звірити консольний звіт, потім без прапорця.
//
// Запуск:
//   node scripts/migrate-keycrm.js --tenant-id=<uuid> --file=./keycrm-export.json [--dry-run]
//   node scripts/migrate-keycrm.js --tenant-id=<uuid> --dry-run   (спробує live KeyCRM API — TODO)

const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../packages/db');

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg.startsWith('--tenant-id=')) out.tenantId = arg.split('=')[1];
    else if (arg.startsWith('--file=')) out.file = arg.split('=')[1];
  }
  return out;
}

// TODO: реальний виклик KeyCRM API (список товарів з custom_fields, пагінація).
// Ключі KeyCRM — тільки в .env цього скрипта на час one-off запуску, ніколи в коді/git.
async function loadFromKeyCrmApi() {
  throw new Error('KeyCRM API ще не підключено — передай --file=<export.json> з ручним експортом, або допиши цю функцію (KEYCRM_API_KEY у .env).');
}

// Очікуваний формат елемента export-файлу — один товар KeyCRM з custom_fields (§4.2 таблиця):
// {
//   name, sku, price, min_price, category_name,
//   description,                      // → presentationText
//   custom_fields: {
//     CT_1001: "токен1,токен2",        // → adMatchTokens
//     CT_1003: "productId1,productId2",// → companionProductIds (очікує вже-мігровані sku/id)
//     CT_1005: "sku:qty,sku:qty",      // → setComponents
//     supplier: "Назва постачальника",
//     CT_1006: "SUP-ART-123",          // → supplierArticle
//   },
//   offers: [{ sku, price, properties: [{name,value}], images: [] }],
// }

async function findOrCreateCategory(tenantId, name, cache) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);
  const existing = await db.category.findFirst({ where: { tenantId, name } });
  const category = existing || await db.category.create({ data: { tenantId, name } });
  cache.set(name, category);
  return category.id;
}

async function findOrCreateSupplier(tenantId, name, cache) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);
  const existing = await db.supplier.findFirst({ where: { tenantId, name } });
  const supplier = existing || await db.supplier.create({ data: { tenantId, name, mechanism: 'ручне' } });
  cache.set(name, supplier.id);
  return supplier.id;
}

async function migrateProduct(tenantId, item, caches, dryRun) {
  const cf = item.custom_fields || {};
  const categoryId = await findOrCreateCategory(tenantId, item.category_name, caches.categories);
  const supplierId = await findOrCreateSupplier(tenantId, cf.supplier, caches.suppliers);

  const data = {
    tenantId,
    name: item.name,
    sku: item.sku,
    price: item.price,
    minPrice: item.min_price ?? null,
    categoryId,
    presentationText: item.description || null,
    adMatchTokens: cf.CT_1001 ? String(cf.CT_1001).split(',').map((s) => s.trim()).filter(Boolean) : [],
    companionProductIds: [], // друга проходка нижче, після того як усі sku вже мають id
    supplierId,
    supplierArticle: cf.CT_1006 || null,
  };

  if (dryRun) {
    console.log(`[dry-run] product ${item.sku}:`, JSON.stringify(data));
    return null;
  }

  const product = await db.product.upsert({
    where: { tenantId_sku: { tenantId, sku: item.sku } },
    update: data,
    create: data,
  });

  if (Array.isArray(item.offers)) {
    for (const offer of item.offers) {
      await db.offer.upsert({
        where: { id: `${product.id}:${offer.sku || 'default'}` }, // немає натурального унікального ключа — просто create якщо sku новий
        update: { price: offer.price, properties: offer.properties || [], images: offer.images || [] },
        create: { productId: product.id, sku: offer.sku || null, price: offer.price ?? null, properties: offer.properties || [], images: offer.images || [] },
      }).catch(() => db.offer.create({ data: { productId: product.id, sku: offer.sku || null, price: offer.price ?? null, properties: offer.properties || [], images: offer.images || [] } }));
    }
  }

  return product;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.tenantId) throw new Error('--tenant-id=<uuid> обовʼязковий');

  const items = args.file
    ? JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8'))
    : await loadFromKeyCrmApi();

  console.log(`Мігрую ${items.length} товарів у tenant ${args.tenantId}${args.dryRun ? ' (dry-run)' : ''}...`);

  const caches = { categories: new Map(), suppliers: new Map() };
  let ok = 0, failed = 0;
  const skuToProductId = new Map();

  for (const item of items) {
    try {
      const product = await migrateProduct(args.tenantId, item, caches, args.dryRun);
      if (product) skuToProductId.set(item.sku, product.id);
      ok++;
    } catch (err) {
      failed++;
      console.error(`✗ ${item.sku}: ${err.message}`);
    }
  }

  // Друга проходка — companionProductIds/setComponents потребують id інших товарів,
  // тому виконуються тільки після того, як усі товари вже отримали свій id.
  if (!args.dryRun) {
    for (const item of items) {
      const cf = item.custom_fields || {};
      const productId = skuToProductId.get(item.sku);
      if (!productId) continue;
      const companionSkus = cf.CT_1003 ? String(cf.CT_1003).split(',').map((s) => s.trim()).filter(Boolean) : [];
      const companionProductIds = companionSkus.map((sku) => skuToProductId.get(sku)).filter(Boolean);
      if (companionProductIds.length) await db.product.update({ where: { id: productId }, data: { companionProductIds } });

      const setPairs = cf.CT_1005 ? String(cf.CT_1005).split(',').map((s) => s.trim()).filter(Boolean) : [];
      for (const pair of setPairs) {
        const [sku, qty] = pair.split(':');
        const componentProductId = skuToProductId.get((sku || '').trim());
        if (!componentProductId) continue;
        await db.productSetComponent.upsert({
          where: { parentProductId_componentProductId: { parentProductId: productId, componentProductId } },
          update: { qty: Number(qty) || 1 },
          create: { parentProductId: productId, componentProductId, qty: Number(qty) || 1 },
        });
      }
    }
  }

  console.log(`Готово: ${ok} ok, ${failed} failed.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
