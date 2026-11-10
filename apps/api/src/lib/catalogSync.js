// Синхронізація каталогу між магазинами (2026-11-10): джерело (CatalogSync.sourceTenantId) → магазин-приймач (CatalogSync.tenantId).
// Односторонній дзеркальний перенос: категорії, постачальники, товари (кольори, розміри, комплекти, допродажі) і за syncCosts — ціна постачальника
// та % менеджера. Записи звʼязуються через syncSourceId (id у джерелі); якщо його ще нема — привʼязуємо за артикулом (товар) чи назвою
// (категорія, постачальник). Нічого НЕ видаляємо: товар, якого більше нема в джерелі, ховається (outOfStock); власні записи приймача не чіпаємо.
const { Prisma } = require('@prisma/client');
const { db } = require('@crm/db');
const { ValidationError, NotFoundError, ConflictError } = require('@crm/errors');

const HOUR_MS = 60 * 60 * 1000;
const running = new Set(); // приймачі, які синхронізуються просто зараз (у цьому процесі)

const jsonOrNull = (v) => (v === null || v === undefined ? Prisma.DbNull : v);
const norm = (s) => String(s || '').trim().toLowerCase();

function categoryData(c, withSync) {
  return {
    name: c.name, description: c.description, aiInstructions: c.aiInstructions, requiredParams: c.requiredParams || [], synonyms: c.synonyms || [],
    fitChart: jsonOrNull(c.fitChart), sizeRules: c.sizeRules || [], sizeChartImage: c.sizeChartImage, sizeChartData: jsonOrNull(c.sizeChartData),
    ...(withSync ? { syncSourceId: c.id } : {}),
  };
}
function supplierData(s) {
  return {
    name: s.name, mechanism: s.mechanism, contactInfo: s.contactInfo, description: s.description, aiNotes: s.aiNotes, website: s.website,
    telegramGroupId: s.telegramGroupId, telegramName: s.telegramName, telegramLink: s.telegramLink, loginUsername: s.loginUsername, loginPassword: s.loginPassword,
    apiConfig: jsonOrNull(s.apiConfig), orderRecipe: s.orderRecipe, syncSourceId: s.id,
  };
}
function productData(p, catMap, supMap) {
  return {
    name: p.name, customerName: p.customerName, sku: p.sku, price: p.price, minPrice: p.minPrice, presentationText: p.presentationText,
    adMatchTokens: p.adMatchTokens || [], supplierArticle: p.supplierArticle, sizeChartImage: p.sizeChartImage, thumbnailUrl: p.thumbnailUrl,
    images: p.images || [], aiNotes: p.aiNotes, sizeChartData: jsonOrNull(p.sizeChartData), fitChart: jsonOrNull(p.fitChart), sizeRules: p.sizeRules || [],
    bulkPricing: p.bulkPricing || [], isSet: p.isSet, alwaysAvailable: p.alwaysAvailable, outOfStock: p.outOfStock, sizes: p.sizes || [],
    categoryId: p.categoryId ? (catMap.get(p.categoryId) || null) : null,
    supplierId: p.supplierId ? (supMap.get(p.supplierId) || null) : null,
    syncSourceId: p.id,
  };
}
function offerData(o) {
  return {
    sku: o.sku, price: o.price, quantity: o.quantity, availableSizes: o.availableSizes || [], sizesCustomized: o.sizesCustomized,
    properties: o.properties || [], images: o.images || [], sortOrder: o.sortOrder, syncSourceId: o.id,
  };
}

/** Звʼязує записи джерела з записами приймача (по syncSourceId, далі по ключу) і створює/оновлює їх. Повертає мапу id джерела → id приймача. */
async function mirrorSimple({ model, tenantId, srcRows, tgtRows, keyOf, build, dryRun, stat }) {
  const bySync = new Map(); const byKey = new Map();
  for (const t of tgtRows) { if (t.syncSourceId) bySync.set(t.syncSourceId, t); byKey.set(keyOf(t), t); }
  const claimed = new Set(); const map = new Map();
  for (const s of srcRows) {
    let t = bySync.get(s.id);
    if (!t) { const cand = byKey.get(keyOf(s)); if (cand && !claimed.has(cand.id)) t = cand; }
    if (t) {
      claimed.add(t.id); stat.updated++;
      if (!dryRun) await db[model].update({ where: { id: t.id }, data: build(s) });
      map.set(s.id, t.id);
    } else {
      stat.created++;
      if (dryRun) map.set(s.id, 'new:' + s.id);
      else map.set(s.id, (await db[model].create({ data: { ...build(s), tenantId } })).id);
    }
  }
  return map;
}

async function syncCatalog(targetTenantId, sourceTenantId, { syncCosts, dryRun }) {
  const started = Date.now();
  const result = { dryRun: !!dryRun, categories: { created: 0, updated: 0 }, suppliers: { created: 0, updated: 0 }, products: { created: 0, updated: 0, hidden: 0 }, errors: [] };

  // 1. Категорії
  const [srcCats, tgtCats] = await Promise.all([
    db.category.findMany({ where: { tenantId: sourceTenantId } }),
    db.category.findMany({ where: { tenantId: targetTenantId } }),
  ]);
  const catMap = await mirrorSimple({ model: 'category', tenantId: targetTenantId, srcRows: srcCats, tgtRows: tgtCats, keyOf: (c) => norm(c.name), build: (c) => categoryData(c, true), dryRun, stat: result.categories });

  // 2. Постачальники
  const [srcSups, tgtSups] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: sourceTenantId } }),
    db.supplier.findMany({ where: { tenantId: targetTenantId } }),
  ]);
  const supMap = await mirrorSimple({ model: 'supplier', tenantId: targetTenantId, srcRows: srcSups, tgtRows: tgtSups, keyOf: (s) => norm(s.name), build: (s) => supplierData(s), dryRun, stat: result.suppliers });

  // 3. Товари — спершу самі товари (щоб знати id для допродажів і комплектів), потім звʼязки
  const srcProducts = await db.product.findMany({ where: { tenantId: sourceTenantId }, include: { offers: { orderBy: { sortOrder: 'asc' } }, setOf: true, productExpense: true } });
  const tgtProducts = await db.product.findMany({ where: { tenantId: targetTenantId }, select: { id: true, sku: true, syncSourceId: true, outOfStock: true } });
  const bySync = new Map(); const bySku = new Map();
  for (const t of tgtProducts) { if (t.syncSourceId) bySync.set(t.syncSourceId, t); bySku.set(t.sku, t); }
  const claimed = new Set(); const prodMap = new Map();
  for (const p of srcProducts) {
    try {
      let t = bySync.get(p.id);
      if (!t) { const cand = bySku.get(p.sku); if (cand && !claimed.has(cand.id)) t = cand; }
      if (t) {
        claimed.add(t.id); result.products.updated++; prodMap.set(p.id, t.id);
        if (!dryRun) await db.product.update({ where: { id: t.id }, data: productData(p, catMap, supMap) });
      } else {
        result.products.created++;
        if (dryRun) prodMap.set(p.id, 'new:' + p.id);
        else prodMap.set(p.id, (await db.product.create({ data: { ...productData(p, catMap, supMap), tenantId: targetTenantId } })).id);
      }
    } catch (e) {
      if (result.errors.length < 20) result.errors.push({ sku: p.sku, message: String(e.message || e).split('\n').filter(Boolean).slice(-1)[0].slice(0, 300) });
    }
  }

  // 4. Звʼязки: допродажі, склад комплектів, варіанти (кольори/розміри), ціни постачальника
  if (!dryRun) {
    for (const p of srcProducts) {
      const tid = prodMap.get(p.id);
      if (!tid) continue; // товар не вдалось створити — помилка вже записана
      try {
        await db.$transaction(async (tx) => {
          await tx.product.update({ where: { id: tid }, data: { companionProductIds: (p.companionProductIds || []).map((id) => prodMap.get(id)).filter(Boolean) } });

          await tx.productSetComponent.deleteMany({ where: { parentProductId: tid } });
          const comps = (p.setOf || []).map((c) => ({ parentProductId: tid, componentProductId: prodMap.get(c.componentProductId), qty: c.qty, fixedColor: c.fixedColor })).filter((c) => c.componentProductId && c.componentProductId !== tid);
          if (comps.length) await tx.productSetComponent.createMany({ data: comps });

          const tgtOffers = await tx.offer.findMany({ where: { productId: tid } });
          const oBySync = new Map(); for (const o of tgtOffers) if (o.syncSourceId) oBySync.set(o.syncSourceId, o);
          const oClaimed = new Set();
          for (const o of p.offers) {
            let t = oBySync.get(o.id);
            if (!t && o.sku) t = tgtOffers.find((x) => !x.syncSourceId && x.sku === o.sku && !oClaimed.has(x.id));
            if (t) { oClaimed.add(t.id); await tx.offer.update({ where: { id: t.id }, data: offerData(o) }); }
            else { const created = await tx.offer.create({ data: { ...offerData(o), productId: tid } }); oClaimed.add(created.id); }
          }
          // Варіанти, яких у джерелі більше нема: прибираємо, якщо ними не оформлені замовлення (історію не ламаємо).
          const stale = tgtOffers.filter((o) => !oClaimed.has(o.id)).map((o) => o.id);
          if (stale.length) await tx.offer.deleteMany({ where: { id: { in: stale }, orderItems: { none: {} } } });

          if (syncCosts && p.productExpense) {
            const e = p.productExpense;
            const d = { tenantId: targetTenantId, cogs: e.cogs, cogsHistory: e.cogsHistory || [], managerCostFixed: e.managerCostFixed, managerCostPercent: e.managerCostPercent };
            await tx.productExpense.upsert({ where: { productId: tid }, create: { ...d, productId: tid }, update: d });
          }
        }, { timeout: 30000 });
      } catch (e) {
        if (result.errors.length < 20) result.errors.push({ sku: p.sku, message: String(e.message || e).split('\n').filter(Boolean).slice(-1)[0].slice(0, 300) });
      }
    }
  }

  // 5. Товари приймача, які раніше прийшли з джерела, а там зникли — ховаємо (не видаляємо: на них можуть бути замовлення).
  const seenSrc = new Set(srcProducts.map((p) => p.id));
  const gone = tgtProducts.filter((t) => t.syncSourceId && !seenSrc.has(t.syncSourceId) && !t.outOfStock);
  result.products.hidden = gone.length;
  if (!dryRun && gone.length) await db.product.updateMany({ where: { id: { in: gone.map((t) => t.id) } }, data: { outOfStock: true } });

  result.durationMs = Date.now() - started;
  return result;
}

async function getConfig(tenantId) {
  const cfg = await db.catalogSync.findUnique({ where: { tenantId } });
  if (!cfg) return null;
  const source = await db.tenant.findUnique({ where: { id: cfg.sourceTenantId }, select: { id: true, name: true } });
  return { ...cfg, source: source || null };
}

/** Зберегти налаштування. sourceTenantId порожній → синхронізацію вимкнено й налаштування видалено (вже перенесені товари лишаються). */
async function saveConfig(tenantId, { sourceTenantId, enabled, syncCosts }) {
  if (!sourceTenantId) { await db.catalogSync.deleteMany({ where: { tenantId } }); return null; }
  if (sourceTenantId === tenantId) throw new ValidationError('Магазин не може синхронізуватись сам із собою');
  const source = await db.tenant.findUnique({ where: { id: sourceTenantId }, include: { catalogSync: true } });
  if (!source) throw new NotFoundError('Tenant', sourceTenantId);
  if (source.catalogSync && source.catalogSync.sourceTenantId === tenantId) throw new ValidationError('Цей магазин сам синхронізується з поточного — так вийшло б коло. Спершу вимкніть синхронізацію там.');
  const data = { sourceTenantId, ...(enabled !== undefined ? { enabled: !!enabled } : {}), ...(syncCosts !== undefined ? { syncCosts: !!syncCosts } : {}) };
  await db.catalogSync.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
  return getConfig(tenantId);
}

/** Запустити синхронізацію приймача (вручну чи за розкладом). dryRun — лише порахувати, що зміниться, нічого не записуючи. */
async function runCatalogSync(tenantId, { dryRun = false } = {}) {
  const cfg = await db.catalogSync.findUnique({ where: { tenantId } });
  if (!cfg) throw new ValidationError('Синхронізацію каталогу не налаштовано: оберіть магазин-джерело');
  const source = await db.tenant.findUnique({ where: { id: cfg.sourceTenantId }, select: { id: true } });
  if (!source) throw new NotFoundError('Tenant', cfg.sourceTenantId);
  if (running.has(tenantId)) throw new ConflictError('Синхронізація вже йде — зачекайте кілька секунд');
  running.add(tenantId);
  try {
    let result;
    try {
      result = await syncCatalog(tenantId, cfg.sourceTenantId, { syncCosts: cfg.syncCosts, dryRun });
    } catch (e) {
      if (!dryRun) await db.catalogSync.update({ where: { tenantId }, data: { lastRunAt: new Date(), lastStatus: 'error', lastResult: { error: String(e.message || e).slice(0, 500) } } });
      throw e;
    }
    if (!dryRun) await db.catalogSync.update({ where: { tenantId }, data: { lastRunAt: new Date(), lastStatus: result.errors.length ? 'partial' : 'ok', lastResult: result } });
    return result;
  } finally { running.delete(tenantId); }
}

/** Щогодинний розклад: бере налаштування з enabled=true, які ще не запускались годину. Захоплення рядка — одним умовним UPDATE, тож два процеси не запустять дубль. */
async function runDueSyncs() {
  const due = await db.catalogSync.findMany({ where: { enabled: true, OR: [{ lastRunAt: null }, { lastRunAt: { lt: new Date(Date.now() - HOUR_MS) } }] }, select: { tenantId: true, lastRunAt: true } });
  for (const d of due) {
    const claim = await db.catalogSync.updateMany({
      where: { tenantId: d.tenantId, enabled: true, lastRunAt: d.lastRunAt },
      data: { lastRunAt: new Date() },
    });
    if (!claim.count) continue;
    try { await runCatalogSync(d.tenantId); } catch (e) { console.error('[catalog-sync]', d.tenantId, e.message); }
  }
}

function startCatalogSyncScheduler() {
  if (process.env.CATALOG_SYNC_SCHEDULER === '0') return;
  const t = setInterval(() => { runDueSyncs().catch((e) => console.error('[catalog-sync] scheduler', e.message)); }, 10 * 60 * 1000);
  if (t.unref) t.unref();
}

module.exports = { getConfig, saveConfig, runCatalogSync, runDueSyncs, startCatalogSyncScheduler, syncCatalog };
