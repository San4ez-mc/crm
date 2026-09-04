// §4.8 Order + OrderItem — основний робочий екран менеджера (§9.7/9.8) + операції для воронки (§5).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { parseFrom, parseTo } = require('../lib/dateRange');

const router = express.Router();

const ORDER_INCLUDE = {
  buyer: true,
  stage: { include: { pipeline: { select: { id: true, name: true } } } },
  items: { include: { product: { select: { id: true, name: true, sku: true } }, offer: { select: { id: true, sku: true } } } },
  returns: true,
  firstTouchAd: { select: { id: true, name: true } },
  lastTouchAd: { select: { id: true, name: true } },
};

async function defaultStageId(tenantId) {
  const pipeline = await db.pipeline.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { order: 'asc' }, take: 1 } } });
  return pipeline?.stages?.[0]?.id || null;
}

// ── Список (kanban/таблиця) ──────────────────────────────────────────────
router.get('/orders', asyncHandler(async (req, res) => {
  const { stageId, from, to, productId, adId, q, take = '100', skip = '0' } = req.query;
  // q і adId — обидва OR-блоки, тому комбінуємо через AND (інакше другий спред перезаписав би
  // перший ключ "OR" в об'єкті where — знайдено під час додавання фільтра по рекламі 2026-09-04).
  const andClauses = [];
  if (q) andClauses.push({ OR: [
    { ttn: { has: String(q) } },
    { buyer: { is: { OR: [{ phone: { contains: String(q) } }, { fullName: { contains: String(q), mode: 'insensitive' } }] } } },
  ] });
  if (adId) andClauses.push({ OR: [{ firstTouchAdId: String(adId) }, { lastTouchAdId: String(adId) }] });
  const where = {
    tenantId: req.tenant.id,
    ...(stageId ? { stageId: String(stageId) } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}),
    ...(productId ? { items: { some: { productId: String(productId) } } } : {}),
    ...(andClauses.length ? { AND: andClauses } : {}),
  };
  const [items, total] = await Promise.all([
    db.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: Number(take), skip: Number(skip) }),
    db.order.count({ where }),
  ]);
  res.json({ ok: true, data: items, meta: { total, take: Number(take), skip: Number(skip) } });
}));

// ── Створення (переважно з воронки) ──────────────────────────────────────
router.post('/orders', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.items) || !b.items.length) throw new ValidationError('items[] обовʼязкові (хоча б одна позиція)');

  let buyerId = b.buyerId || null;
  if (!buyerId && b.buyer?.phone) {
    const normalized = String(b.buyer.phone).replace(/[^\d+]/g, '');
    const buyer = await db.buyer.upsert({
      where: { tenantId_phone: { tenantId: req.tenant.id, phone: normalized } },
      update: {},
      create: { tenantId: req.tenant.id, phone: normalized, fullName: b.buyer.fullName || null, igUsername: b.buyer.igUsername || null },
    });
    buyerId = buyer.id;
  }

  const stageId = b.stageId || await defaultStageId(req.tenant.id);

  const order = await db.order.create({
    data: {
      tenantId: req.tenant.id,
      buyerId,
      stageId,
      sourceName: b.sourceName || null,
      managerComment: b.managerComment || null,
      shipping: b.shipping || null,
      ttn: Array.isArray(b.ttn) ? b.ttn : [],
      firstTouchAdId: b.firstTouchAdId || null,
      firstTouchAt: b.firstTouchAt ? new Date(b.firstTouchAt) : (b.firstTouchAdId ? new Date() : null),
      lastTouchAdId: b.lastTouchAdId || null,
      lastTouchAt: b.lastTouchAt ? new Date(b.lastTouchAt) : (b.lastTouchAdId ? new Date() : null),
      items: {
        create: b.items.map((it) => ({
          productId: it.productId || null,
          offerId: it.offerId || null,
          name: it.name,
          price: it.price,
          quantity: Number(it.quantity) || 1,
          properties: it.properties || null,
          isUpsell: !!it.isUpsell,
        })),
      },
    },
    include: ORDER_INCLUDE,
  });
  res.status(201).json({ ok: true, data: order });
}));

router.get('/orders/:id', asyncHandler(async (req, res) => {
  const order = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: ORDER_INCLUDE });
  if (!order) throw new NotFoundError('Order', req.params.id);
  res.json({ ok: true, data: order });
}));

router.patch('/orders/:id', asyncHandler(async (req, res) => {
  const existing = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Order', req.params.id);
  const b = req.body || {};
  const order = await db.order.update({
    where: { id: existing.id },
    data: {
      ...(b.stageId !== undefined ? { stageId: b.stageId } : {}),
      ...(b.managerComment !== undefined ? { managerComment: b.managerComment } : {}),
      ...(b.shipping !== undefined ? { shipping: b.shipping } : {}),
      ...(b.ttn !== undefined ? { ttn: Array.isArray(b.ttn) ? b.ttn : [] } : {}),
      ...(b.sourceName !== undefined ? { sourceName: b.sourceName } : {}),
      ...(b.isRefused !== undefined ? { isRefused: !!b.isRefused } : {}),
    },
    include: ORDER_INCLUDE,
  });
  res.json({ ok: true, data: order });
}));

// Flows-крон опитує Нову Пошту і пише сюди статус (§5, §2 ТЗ) — той самий Bearer tenant.apiKey.
// isRefused — опційний: сам крон вирішує за сирим статусом НП, чи це "Відмова" (CRM лише зберігає факт).
router.patch('/orders/:id/ttn-status', asyncHandler(async (req, res) => {
  const existing = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Order', req.params.id);
  const { ttnStatus, isRefused } = req.body || {};
  if (!ttnStatus) throw new ValidationError('ttnStatus обовʼязковий');
  const order = await db.order.update({
    where: { id: existing.id },
    data: { ttnStatus: String(ttnStatus), ...(isRefused !== undefined ? { isRefused: !!isRefused } : {}) },
  });
  res.json({ ok: true, data: { id: order.id, ttnStatus: order.ttnStatus, isRefused: order.isRefused } });
}));

// Атрибуція first/last-touch — воронка викликає в момент кліку по рекламі / перед оформленням (§4.8).
router.patch('/orders/:id/attribution', asyncHandler(async (req, res) => {
  const existing = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Order', req.params.id);
  const { firstTouchAdId, lastTouchAdId } = req.body || {};
  const order = await db.order.update({
    where: { id: existing.id },
    data: {
      ...(firstTouchAdId !== undefined ? { firstTouchAdId, firstTouchAt: firstTouchAdId ? new Date() : null } : {}),
      ...(lastTouchAdId !== undefined ? { lastTouchAdId, lastTouchAt: lastTouchAdId ? new Date() : null } : {}),
    },
  });
  res.json({ ok: true, data: order });
}));

module.exports = router;
