// §4.2/§4.3 Product + Offer — CRUD, tenant-scoped. Включає catalog/search-ендпойнти,
// якими сьогодні користується n_lookup-code.js воронки (§5 ТЗ).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError, ConflictError } = require('@crm/errors');

const router = express.Router();

const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  offers: { orderBy: { sortOrder: 'asc' } },
  setOf: { include: { componentProduct: { select: { id: true, name: true, sku: true } } } },
  _count: { select: { orderItems: true } },
};

function serializeProduct(p) {
  return {
    ...p,
    offersCount: p.offers ? p.offers.length : undefined,
    setComponents: p.setOf ? p.setOf.map((sc) => ({ productId: sc.componentProductId, name: sc.componentProduct.name, sku: sc.componentProduct.sku, qty: sc.qty })) : undefined,
    setOf: undefined,
    _count: undefined,
  };
}

// ── Список / пошук (адмінка + бот через n_lookup-code.js) ──────────────────
router.get('/products', asyncHandler(async (req, res) => {
  const { q, categoryId, supplierId, sku, take = '50', skip = '0' } = req.query;
  const where = {
    tenantId: req.tenant.id,
    ...(categoryId ? { categoryId: String(categoryId) } : {}),
    ...(supplierId ? { supplierId: String(supplierId) } : {}),
    ...(sku ? { sku: String(sku) } : {}),
    ...(q ? { OR: [
      { name: { contains: String(q), mode: 'insensitive' } },
      { sku: { contains: String(q), mode: 'insensitive' } },
      { adMatchTokens: { has: String(q) } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    db.product.findMany({ where, include: PRODUCT_INCLUDE, orderBy: { updatedAt: 'desc' }, take: Number(take), skip: Number(skip) }),
    db.product.count({ where }),
  ]);
  res.json({ ok: true, data: items.map(serializeProduct), meta: { total, take: Number(take), skip: Number(skip) } });
}));

router.post('/products', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) throw new ValidationError('name обовʼязкове');
  if (!b.sku || !String(b.sku).trim()) throw new ValidationError('sku обовʼязкове');
  if (b.price === undefined || b.price === null || Number.isNaN(Number(b.price))) throw new ValidationError('price обовʼязкове');

  const dup = await db.product.findFirst({ where: { tenantId: req.tenant.id, sku: String(b.sku).trim() } });
  if (dup) throw new ConflictError('Товар з таким sku вже існує', { sku: b.sku });

  const product = await db.product.create({
    data: {
      tenantId: req.tenant.id,
      name: String(b.name).trim(),
      sku: String(b.sku).trim(),
      price: b.price,
      minPrice: b.minPrice ?? null,
      categoryId: b.categoryId || null,
      presentationText: b.presentationText || null,
      adMatchTokens: Array.isArray(b.adMatchTokens) ? b.adMatchTokens : [],
      companionProductIds: Array.isArray(b.companionProductIds) ? b.companionProductIds : [],
      supplierId: b.supplierId || null,
      supplierArticle: b.supplierArticle || null,
      sizeChartImage: b.sizeChartImage || null,
      thumbnailUrl: b.thumbnailUrl || null,
      images: Array.isArray(b.images) ? b.images : [],
      aiNotes: b.aiNotes || null,
      sizeChartData: b.sizeChartData ?? undefined,
    },
    include: PRODUCT_INCLUDE,
  });
  res.status(201).json({ ok: true, data: serializeProduct(product) });
}));

router.get('/products/:id', asyncHandler(async (req, res) => {
  const product = await db.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: PRODUCT_INCLUDE });
  if (!product) throw new NotFoundError('Product', req.params.id);
  res.json({ ok: true, data: serializeProduct(product) });
}));

router.patch('/products/:id', asyncHandler(async (req, res) => {
  const existing = await db.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Product', req.params.id);
  const b = req.body || {};
  if (b.sku && b.sku !== existing.sku) {
    const dup = await db.product.findFirst({ where: { tenantId: req.tenant.id, sku: String(b.sku).trim(), NOT: { id: existing.id } } });
    if (dup) throw new ConflictError('Товар з таким sku вже існує', { sku: b.sku });
  }
  const product = await db.product.update({
    where: { id: existing.id },
    data: {
      ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
      ...(b.sku !== undefined ? { sku: String(b.sku).trim() } : {}),
      ...(b.price !== undefined ? { price: b.price } : {}),
      ...(b.minPrice !== undefined ? { minPrice: b.minPrice } : {}),
      ...(b.categoryId !== undefined ? { categoryId: b.categoryId || null } : {}),
      ...(b.presentationText !== undefined ? { presentationText: b.presentationText } : {}),
      ...(b.adMatchTokens !== undefined ? { adMatchTokens: Array.isArray(b.adMatchTokens) ? b.adMatchTokens : [] } : {}),
      ...(b.companionProductIds !== undefined ? { companionProductIds: Array.isArray(b.companionProductIds) ? b.companionProductIds : [] } : {}),
      ...(b.supplierId !== undefined ? { supplierId: b.supplierId || null } : {}),
      ...(b.supplierArticle !== undefined ? { supplierArticle: b.supplierArticle } : {}),
      ...(b.sizeChartImage !== undefined ? { sizeChartImage: b.sizeChartImage } : {}),
      ...(b.thumbnailUrl !== undefined ? { thumbnailUrl: b.thumbnailUrl } : {}),
      ...(b.images !== undefined ? { images: Array.isArray(b.images) ? b.images : [] } : {}),
      ...(b.aiNotes !== undefined ? { aiNotes: b.aiNotes } : {}),
      ...(b.sizeChartData !== undefined ? { sizeChartData: b.sizeChartData } : {}),
    },
    include: PRODUCT_INCLUDE,
  });
  res.json({ ok: true, data: serializeProduct(product) });
}));

router.delete('/products/:id', asyncHandler(async (req, res) => {
  const existing = await db.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { _count: { select: { orderItems: true } } } });
  if (!existing) throw new NotFoundError('Product', req.params.id);
  if (existing._count.orderItems > 0) throw new ConflictError('Товар задіяний у замовленнях — видалення заблоковано', { orderItems: existing._count.orderItems });
  await db.product.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

// ── §4.2 setComponents[] — {componentProductId, qty}[], повна заміна набору ─
router.put('/products/:id/set-components', asyncHandler(async (req, res) => {
  const existing = await db.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Product', req.params.id);
  const list = Array.isArray(req.body?.components) ? req.body.components : [];
  await db.$transaction([
    db.productSetComponent.deleteMany({ where: { parentProductId: existing.id } }),
    ...(list.length ? [db.productSetComponent.createMany({
      data: list.map((c) => ({ parentProductId: existing.id, componentProductId: c.componentProductId, qty: Number(c.qty) || 1 })),
    })] : []),
  ]);
  res.json({ ok: true, data: { id: existing.id, components: list } });
}));

// ── §4.3 Offer (варіант товару) ─────────────────────────────────────────────
router.post('/products/:id/offers', asyncHandler(async (req, res) => {
  const product = await db.product.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!product) throw new NotFoundError('Product', req.params.id);
  const b = req.body || {};
  const offer = await db.offer.create({
    data: {
      productId: product.id,
      sku: b.sku || null,
      price: b.price ?? null,
      properties: Array.isArray(b.properties) ? b.properties : [],
      images: Array.isArray(b.images) ? b.images.slice(0, 10) : [],
      sortOrder: Number(b.sortOrder) || 0,
    },
  });
  res.status(201).json({ ok: true, data: offer });
}));

router.patch('/offers/:id', asyncHandler(async (req, res) => {
  const existing = await db.offer.findFirst({ where: { id: req.params.id, product: { tenantId: req.tenant.id } } });
  if (!existing) throw new NotFoundError('Offer', req.params.id);
  const b = req.body || {};
  const offer = await db.offer.update({
    where: { id: existing.id },
    data: {
      ...(b.sku !== undefined ? { sku: b.sku } : {}),
      ...(b.price !== undefined ? { price: b.price } : {}),
      ...(b.properties !== undefined ? { properties: Array.isArray(b.properties) ? b.properties : [] } : {}),
      ...(b.images !== undefined ? { images: Array.isArray(b.images) ? b.images.slice(0, 10) : [] } : {}),
      ...(b.sortOrder !== undefined ? { sortOrder: Number(b.sortOrder) || 0 } : {}),
    },
  });
  res.json({ ok: true, data: offer });
}));

router.delete('/offers/:id', asyncHandler(async (req, res) => {
  const existing = await db.offer.findFirst({ where: { id: req.params.id, product: { tenantId: req.tenant.id } } });
  if (!existing) throw new NotFoundError('Offer', req.params.id);
  await db.offer.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

module.exports = router;
