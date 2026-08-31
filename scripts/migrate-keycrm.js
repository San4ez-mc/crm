#!/usr/bin/env node
// Реальна одноразова міграція каталогу з KeyCRM у Fineko CRM (§2 ТЗ).
//
// ВАЖЛИВО: один KeyCRM-акаунт обслуговує ДВА магазини одночасно — товари з
// category_id=3 ("Автотовари") належать covercar_ua, решта — goverla_shop.
// Тому скрипт сам створює/знаходить обидва tenant за назвою і розкладає товари.
//
// Реальні коди custom_fields (перевірено живим запитом до API 2026-08-30 — ВІДРІЗНЯЮТЬСЯ
// від застарілих нотаток у §4.2 ТЗ, довіряємо факту, не старому папірцю):
//   CT_1002 "Допродажі"                      → companionProductIds (було помилково записано як CT_1003)
//   CT_1003 "Постачальник"                    → Supplier (select, значення напр. "brewdrop.in.ua")
//   CT_1005 "Склад набору"                    → setComponents (список sku/offer-sku без явної qty)
//   CT_1006 "Артикул постачальника"           → supplierArticle
//   CT_1007/1008/1009 "Ціна за 2/3/4 шт"       → Product.bulkPricing [{quantity,price}] (одна й та сама
//                                                ціна для всіх варіантів кольору — підтверджено власником)
//   CT_1010 "Розмірна сітка (посилання...)"   → sizeChartImage (Google Drive link → перезаливаємо в наше /uploads, як прямо вимагає §4.2)
//   CT_1011 "Додаткова інформація для ШІ"     → Product.aiNotes (нове поле, якого не було в §4.2)
//   CT_1012 "Розмірна сітка" (JSON-текст)      → Product.sizeChartData (нове поле, якого не було в §4.2)
//   CT_1001 в живих даних не зустрічається — adMatchTokens лишається порожнім масивом.
//
// thumbnail_url / attachments_data[] лишаються зовнішніми посиланнями на CDN KeyCRM
// (НЕ перезаливаємо) — на відміну від sizeChartImage, ТЗ не вимагає цього явно саме для
// них, а перезалив десятків фото за один прогін недоцільний для v1-міграції.
//
// Запуск:
//   KEYCRM_API_TOKEN=... DATABASE_URL=... node scripts/migrate-keycrm.js --dry-run
//   KEYCRM_API_TOKEN=... DATABASE_URL=... node scripts/migrate-keycrm.js --apply

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { db } = require('../packages/db');

const KEYCRM_BASE = 'https://openapi.keycrm.app/v1';
const TOKEN = process.env.KEYCRM_API_TOKEN;
const UPLOADS_ROOT = path.join(__dirname, '../uploads');

const TENANT_NAME_FOR_CATEGORY = (categoryId) => (categoryId === 3 ? 'covercar_ua' : 'goverla_shop');
// Всі три поля тепер мапляться (bulkPricing) — довідкового "unmapped" списку по них більше нема.
const KNOWN_UNMAPPED_CODES = new Set();

// Механізм постачальника — в KeyCRM це просто текстове select-значення, самого "механізму"
// (API/офлайн-форма/ручне) там нема. Мапимо за відомою власнику номенклатурою постачальників
// (підтверджено описом бота: "Постачальники: brewdrop (API), easydrop (офлайн-форма+дропшип-кошик)");
// усе, чого нема в мапі, лишається дефолтним "ручне" (можна поправити вручну в адмінці).
const SUPPLIER_MECHANISM_BY_NAME = {
  'brewdrop.in.ua': 'BrewDrop',
  'easydrop': 'EasyDrop',
};
function resolveSupplierMechanism(name) {
  const key = String(name || '').trim().toLowerCase();
  for (const [needle, mechanism] of Object.entries(SUPPLIER_MECHANISM_BY_NAME)) {
    if (key.includes(needle)) return mechanism;
  }
  return 'ручне';
}
// "Комплекти" — окрема категорія в KeyCRM → в нашій моделі це прапорець Product.isSet,
// а не категорія (див. CLAUDE.md/ТЗ-фідбек власника) — категорію все одно фіксуємо (для довідки),
// але додатково піднімаємо isSet=true.
const SET_CATEGORY_NAME = 'Комплекти';

function bulkPricingFromCustomFields(cf) {
  const rows = [];
  const specs = [['CT_1007', 2], ['CT_1008', 3], ['CT_1009', 4]];
  for (const [code, quantity] of specs) {
    const raw = cf.get(code)?.value;
    const price = raw !== undefined && raw !== null && raw !== '' ? Number(raw) : null;
    if (price !== null && !Number.isNaN(price)) rows.push({ quantity, price });
  }
  return rows;
}

function parseArgs(argv) {
  const out = { dryRun: false, apply: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--apply') out.apply = true;
  }
  if (!out.dryRun && !out.apply) out.dryRun = true; // безпечний дефолт
  return out;
}

async function keycrmGet(pathAndQuery) {
  const res = await fetch(`${KEYCRM_BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`KeyCRM GET ${pathAndQuery} → HTTP ${res.status}`);
  return res.json();
}

async function fetchAllPages(pathBuilder) {
  let page = 1;
  const all = [];
  for (;;) {
    const json = await keycrmGet(pathBuilder(page));
    all.push(...json.data);
    if (page >= (json.last_page || 1)) break;
    page++;
  }
  return all;
}

async function fetchCategories() {
  const rows = await fetchAllPages((page) => `/products/categories?limit=50&page=${page}`);
  return new Map(rows.map((c) => [c.id, c.name]));
}

async function fetchProducts() {
  return fetchAllPages((page) => `/products?include=customFields&limit=50&page=${page}`);
}

async function fetchOffers(productId) {
  return fetchAllPages((page) => `/offers?filter[product_id]=${productId}&limit=50&page=${page}`);
}

function customFieldMap(product) {
  const map = new Map();
  for (const f of product.custom_fields || []) map.set(f.uuid, f);
  return map;
}

function splitTokens(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

async function downloadToUploads(tenantId, url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (path.extname(new URL(url).pathname) || '.jpg').slice(0, 10);
  const dir = path.join(UPLOADS_ROOT, tenantId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);
  return `/uploads/${tenantId}/${filename}`;
}

async function findOrCreateTenant(name, cache) {
  if (cache.has(name)) return cache.get(name);
  let tenant = await db.tenant.findFirst({ where: { name } });
  if (!tenant) tenant = await db.tenant.create({ data: { name } });
  cache.set(name, tenant);
  return tenant;
}

async function findOrCreateCategory(tenantId, name, cache) {
  const key = `${tenantId}:${name}`;
  if (cache.has(key)) return cache.get(key);
  let category = await db.category.findFirst({ where: { tenantId, name } });
  if (!category) category = await db.category.create({ data: { tenantId, name } });
  cache.set(key, category.id);
  return category.id;
}

async function findOrCreateSupplier(tenantId, name, cache) {
  if (!name) return null;
  const key = `${tenantId}:${name}`;
  if (cache.has(key)) return cache.get(key);
  let supplier = await db.supplier.findFirst({ where: { tenantId, name } });
  if (!supplier) supplier = await db.supplier.create({ data: { tenantId, name, mechanism: resolveSupplierMechanism(name) } });
  else if (!supplier.mechanism || supplier.mechanism === 'ручне') {
    const resolved = resolveSupplierMechanism(name);
    if (resolved !== 'ручне') supplier = await db.supplier.update({ where: { id: supplier.id }, data: { mechanism: resolved } });
  }
  cache.set(key, supplier.id);
  return supplier.id;
}

/** sku/offer-sku токен ("C0043-1" або "5931") → productId цього ж tenant. */
async function resolveTokenToProductId(tenantId, token) {
  const bySku = await db.product.findFirst({ where: { tenantId, sku: token } });
  if (bySku) return bySku.id;
  const byOfferSku = await db.offer.findFirst({ where: { sku: token, product: { tenantId } }, select: { productId: true } });
  if (byOfferSku) return byOfferSku.productId;
  const stripped = token.replace(/-\d+$/, '');
  if (stripped !== token) {
    const byStripped = await db.product.findFirst({ where: { tenantId, sku: stripped } });
    if (byStripped) return byStripped.id;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!TOKEN) throw new Error('KEYCRM_API_TOKEN обовʼязковий (env)');

  console.log(`== Міграція KeyCRM → Fineko CRM ${args.apply ? '(APPLY — пишемо в БД)' : '(DRY-RUN — нічого не пишемо)'} ==`);

  const [categories, products] = await Promise.all([fetchCategories(), fetchProducts()]);
  console.log(`Знайдено ${products.length} товарів, ${categories.size} категорій у KeyCRM.`);

  const tenantCache = new Map();
  const categoryCache = new Map();
  const supplierCache = new Map();
  const report = { byTenant: {}, unmappedFields: [], resolutionFailures: [], sizeChartDownloadFailures: [] };

  // Прохід 1: створити/оновити Product + Offer (без companion/set — вони потребують id інших товарів).
  const productByKeyCrmId = new Map(); // keycrm product.id → { crmProductId, tenantName, sku }

  for (const p of products) {
    const tenantName = TENANT_NAME_FOR_CATEGORY(p.category_id);
    report.byTenant[tenantName] = (report.byTenant[tenantName] || 0) + 1;
    const cf = customFieldMap(p);

    for (const code of cf.keys()) {
      if (KNOWN_UNMAPPED_CODES.has(code)) {
        report.unmappedFields.push({ product: p.name, code, name: cf.get(code).name, value: cf.get(code).value });
      }
    }

    if (!args.apply) { productByKeyCrmId.set(p.id, { crmProductId: null, tenantName, sku: p.sku || `keycrm-${p.id}` }); continue; }

    const tenant = await findOrCreateTenant(tenantName, tenantCache);
    const categoryName = categories.get(p.category_id) || null;
    const categoryId = categoryName ? await findOrCreateCategory(tenant.id, categoryName, categoryCache) : null;
    const supplierField = cf.get('CT_1003');
    const supplierName = Array.isArray(supplierField?.value) ? supplierField.value[0] : supplierField?.value;
    const supplierId = await findOrCreateSupplier(tenant.id, supplierName, supplierCache);

    let sizeChartImage = null;
    const sizeChartLink = cf.get('CT_1010')?.value;
    if (sizeChartLink) {
      try { sizeChartImage = await downloadToUploads(tenant.id, sizeChartLink); }
      catch (err) { sizeChartImage = sizeChartLink; report.sizeChartDownloadFailures.push({ product: p.name, url: sizeChartLink, error: err.message }); }
    }

    let sizeChartData = null;
    const rawChart = cf.get('CT_1012')?.value;
    if (rawChart) { try { sizeChartData = JSON.parse(rawChart); } catch { sizeChartData = { raw: rawChart }; } }

    // sku обовʼязковий і унікальний у нашій моделі — для товарів-з-варіантами KeyCRM не дає
    // sku на рівні продукту (він живе на offer), тому підставляємо перший offer-sku пізніше.
    const offers = p.has_offers ? await fetchOffers(p.id) : [];
    const baseSku = p.sku || (offers[0]?.sku ? offers[0].sku.replace(/-\d+$/, '') : `keycrm-${p.id}`);
    const basePrice = p.price ?? offers[0]?.price ?? p.min_price ?? 0;

    const productData = {
      tenantId: tenant.id,
      name: p.name,
      sku: baseSku,
      price: basePrice,
      minPrice: p.min_price ?? null,
      categoryId,
      presentationText: p.description || null,
      adMatchTokens: [],
      supplierId,
      supplierArticle: cf.get('CT_1006')?.value || null,
      sizeChartImage,
      thumbnailUrl: p.thumbnail_url || null,
      images: Array.isArray(p.attachments_data) ? p.attachments_data : [],
      aiNotes: cf.get('CT_1011')?.value || null,
      sizeChartData: sizeChartData ?? undefined,
      bulkPricing: bulkPricingFromCustomFields(cf),
      isSet: categoryName === SET_CATEGORY_NAME,
    };

    const crmProduct = await db.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku: baseSku } },
      update: productData,
      create: productData,
    });
    productByKeyCrmId.set(p.id, { crmProductId: crmProduct.id, tenantId: tenant.id, tenantName, sku: baseSku });

    for (const offer of offers) {
      // Offer.sku не унікальний у схемі (немає @@unique) — upsert по id неможливий, шукаємо вручну.
      const existingOffer = offer.sku ? await db.offer.findFirst({ where: { productId: crmProduct.id, sku: offer.sku } }) : null;
      const offerData = {
        productId: crmProduct.id,
        sku: offer.sku || null,
        price: offer.price ?? null, // лишаємо як історичні дані з KeyCRM (§4.3 UI більше не редагує)
        quantity: Number.isFinite(offer.in_reserve) ? offer.in_reserve : (Number.isFinite(offer.quantity) ? offer.quantity : null),
        properties: Array.isArray(offer.properties) ? offer.properties : [],
        images: offer.thumbnail_url ? [offer.thumbnail_url] : [],
      };
      if (existingOffer) await db.offer.update({ where: { id: existingOffer.id }, data: offerData });
      else await db.offer.create({ data: offerData });
    }
  }

  // Прохід 2: companionProductIds + setComponents — потребують id УЖЕ мігрованих товарів.
  if (args.apply) {
    for (const p of products) {
      const mapped = productByKeyCrmId.get(p.id);
      if (!mapped?.crmProductId) continue;
      const cf = customFieldMap(p);
      const tenant = await findOrCreateTenant(mapped.tenantName, tenantCache);

      const companionTokens = splitTokens(cf.get('CT_1002')?.value);
      const companionIds = [];
      for (const token of companionTokens) {
        const id = await resolveTokenToProductId(tenant.id, token);
        if (id) companionIds.push(id);
        else report.resolutionFailures.push({ product: p.name, field: 'companionProductIds (CT_1002)', token });
      }
      if (companionIds.length) await db.product.update({ where: { id: mapped.crmProductId }, data: { companionProductIds: [...new Set(companionIds)] } });

      // "Склад набору" — плаский список sku/offer-sku без явної кількості (декілька офер-варіантів
      // одного компонента підряд = "клієнт обирає колір/розмір цієї частини", не qty>1). Тому дедуплікуємо
      // до УНІКАЛЬНИХ PRODUCT-компонентів з qty=1 — те, що дозволяє наша модель (componentProductId,qty).
      const setTokens = splitTokens(cf.get('CT_1005')?.value);
      const setProductIds = new Set();
      for (const token of setTokens) {
        const id = await resolveTokenToProductId(tenant.id, token);
        if (id && id !== mapped.crmProductId) setProductIds.add(id);
        else if (!id) report.resolutionFailures.push({ product: p.name, field: 'setComponents (CT_1005)', token });
      }
      if (setProductIds.size) {
        await db.$transaction([
          db.productSetComponent.deleteMany({ where: { parentProductId: mapped.crmProductId } }),
          db.productSetComponent.createMany({ data: [...setProductIds].map((componentProductId) => ({ parentProductId: mapped.crmProductId, componentProductId, qty: 1 })) }),
        ]);
      }
    }
  }

  // ── Звіт ──────────────────────────────────────────────────────────────
  console.log('\n== Звіт ==');
  console.log('Розподіл по tenant:', report.byTenant);
  if (report.unmappedFields.length) {
    console.log(`\n⚠ Custom fields без мапінгу в модель (${report.unmappedFields.length}) — рішення за людиною:`);
    for (const f of report.unmappedFields) console.log(`  - ${f.product}: ${f.code} "${f.name}" = ${JSON.stringify(f.value)}`);
  }
  if (report.resolutionFailures.length) {
    console.log(`\n⚠ Не вдалось знайти товар за токеном (${report.resolutionFailures.length}):`);
    for (const f of report.resolutionFailures) console.log(`  - ${f.product} / ${f.field}: "${f.token}" не знайдено`);
  }
  if (report.sizeChartDownloadFailures.length) {
    console.log(`\n⚠ Не вдалось перезалити розмірну сітку, лишили зовнішнє посилання (${report.sizeChartDownloadFailures.length}):`);
    for (const f of report.sizeChartDownloadFailures) console.log(`  - ${f.product}: ${f.error}`);
  }
  if (!args.apply) console.log('\n(dry-run — нічого не записано; повторити з --apply щоб застосувати)');
  else console.log('\nГотово — застосовано в БД.');
}

main().catch((err) => { console.error(err); process.exit(1); });
