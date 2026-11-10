// Відкритий каталог для вітрини сайту/лендінгу (2026-11-10, власник: «щоб відкритий ключ теж віддавав товари й категорії»).
// Той самий відкритий ключ Tenant.publicKey, що й для замовлень з лендінгу; ЛИШЕ читання, і лише те, що не секрет: ніяких цін постачальника,
// постачальників, нотаток для ШІ, мінімальної ціни, токенів реклами. Товари, яких немає в наявності, за замовчуванням не віддаємо.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, AuthError, NotFoundError } = require('@crm/errors');
const { offerEffectiveSizes, offerInStock } = require('../lib/productView');

const router = express.Router();

// Ліміт запитів з однієї адреси: 120 за хвилину (вітрина читає часто, але це не привід віддавати каталог ботам без обмежень).
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_HITS = 120;
function tooMany(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) for (const [k, v] of HITS) if (!v.some((t) => now - t < WINDOW_MS)) HITS.delete(k);
  return arr.length > MAX_HITS;
}

const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

async function tenantFrom(req, res) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (tooMany(ip)) { res.status(429).json({ ok: false, error: { code: 'RATE_LIMIT', message: 'Забагато запитів — спробуйте за хвилину' } }); return null; }
  const key = str(req.header('x-public-key') || req.query.key, 80);
  const tenant = key ? await db.tenant.findUnique({ where: { publicKey: key }, select: { id: true } }) : null;
  if (!tenant) throw new AuthError('Невірний ключ магазину');
  return tenant;
}

const INCLUDE = {
  category: { select: { id: true, name: true } },
  offers: { orderBy: { sortOrder: 'asc' } },
  setOf: { include: { componentProduct: { select: { name: true, customerName: true, sku: true, outOfStock: true } } } },
};

/** Лише безпечні поля для вітрини. */
function publicProduct(p) {
  return {
    id: p.id, sku: p.sku, name: p.customerName || p.name, price: Number(p.price),
    bulkPricing: Array.isArray(p.bulkPricing) ? p.bulkPricing : [],
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    description: p.presentationText || '', images: p.images || [], thumbnail: p.thumbnailUrl || (p.images && p.images[0]) || null,
    isSet: !!p.isSet, inStock: !p.outOfStock,
    sizes: p.sizes || [], sizeChartImage: p.sizeChartImage || null, sizeChart: p.sizeChartData || null,
    colors: (p.offers || []).map((o) => ({
      id: o.id, sku: o.sku || null,
      color: (Array.isArray(o.properties) ? o.properties : []).map((x) => x && x.value).filter(Boolean).join(' '),
      images: o.images || [], sizes: offerEffectiveSizes(p, o), inStock: offerInStock(p, o),
    })),
    ...(p.isSet ? { setItems: (p.setOf || []).map((sc) => ({ name: sc.componentProduct.customerName || sc.componentProduct.name, sku: sc.componentProduct.sku, qty: sc.qty, color: sc.fixedColor || null })) } : {}),
  };
}

// GET /api/public/products?key=…&q=&categoryId=&sku=&isSet=&take=&skip=&includeOutOfStock=1
router.get('/public/products', asyncHandler(async (req, res) => {
  const tenant = await tenantFrom(req, res); if (!tenant) return;
  const { q, categoryId, sku, isSet, includeOutOfStock } = req.query;
  const take = Math.min(Math.max(parseInt(req.query.take, 10) || 50, 1), 100);
  const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
  const where = {
    tenantId: tenant.id,
    ...(includeOutOfStock === '1' || includeOutOfStock === 'true' ? {} : { outOfStock: false }),
    ...(categoryId ? { categoryId: str(categoryId, 60) } : {}),
    ...(sku ? { sku: str(sku, 60) } : {}),
    ...(isSet !== undefined ? { isSet: isSet === 'true' || isSet === '1' } : {}),
    ...(q ? { OR: [{ name: { contains: str(q, 80), mode: 'insensitive' } }, { customerName: { contains: str(q, 80), mode: 'insensitive' } }, { sku: { contains: str(q, 80), mode: 'insensitive' } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.product.findMany({ where, include: INCLUDE, orderBy: { updatedAt: 'desc' }, take, skip }),
    db.product.count({ where }),
  ]);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ ok: true, data: items.map(publicProduct), meta: { total, take, skip } });
}));

// GET /api/public/products/:idOrSku?key=…
router.get('/public/products/:idOrSku', asyncHandler(async (req, res) => {
  const tenant = await tenantFrom(req, res); if (!tenant) return;
  const v = str(req.params.idOrSku, 80);
  if (!v) throw new ValidationError('Вкажіть id або артикул');
  const p = await db.product.findFirst({ where: { tenantId: tenant.id, OR: [{ id: v }, { sku: v }] }, include: INCLUDE });
  if (!p) throw new NotFoundError('Product', v);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ ok: true, data: publicProduct(p) });
}));

// GET /api/public/categories?key=…  (лише категорії, у яких є товари в наявності)
router.get('/public/categories', asyncHandler(async (req, res) => {
  const tenant = await tenantFrom(req, res); if (!tenant) return;
  const cats = await db.category.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, description: true, products: { where: { outOfStock: false }, select: { id: true } } },
    orderBy: { name: 'asc' },
  });
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ ok: true, data: cats.filter((c) => c.products.length).map((c) => ({ id: c.id, name: c.name, description: c.description || '', productsCount: c.products.length })) });
}));

module.exports = router;
