// §6 Аналітика — 5 звітів, кожен з фільтром період (+ товар/реклама де доречно).
// Скрізь виключаємо замовлення, на які є Return (щоб маржа/конверсія не завищувались, §4.11).
// Органічні звернення (без реклами) мають порожні firstTouchAdId/lastTouchAdId — виключаються
// з розрахунків по рекламі природно (§2, "AdClick для органічних звернень").
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { parseFrom, parseTo } = require('../lib/dateRange');

const router = express.Router();

function periodWhere(from, to) {
  if (!from && !to) return {};
  return { createdAt: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } };
}

// ── §6.1 Топ товарів за продажами ────────────────────────────────────────
router.get('/analytics/top-products', asyncHandler(async (req, res) => {
  const { from, to, includeUpsells } = req.query;
  const items = await db.orderItem.findMany({
    where: {
      order: { tenantId: req.tenant.id, ...periodWhere(from, to), returns: { none: {} } },
      ...(includeUpsells === 'true' ? {} : { isUpsell: false }),
    },
    include: { product: { select: { id: true, name: true, sku: true } } },
  });
  const byProduct = new Map();
  for (const it of items) {
    const key = it.productId || `unlinked:${it.name}`;
    const row = byProduct.get(key) || { productId: it.productId, name: it.product?.name || it.name, sku: it.product?.sku || null, quantity: 0, revenue: 0 };
    row.quantity += it.quantity;
    row.revenue += Number(it.price) * it.quantity;
    byProduct.set(key, row);
  }
  const data = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue);
  res.json({ ok: true, data });
}));

// ── §6.2 Реклама: кліки → покупки (first-touch і last-touch окремо) ──────
router.get('/analytics/ads-conversion', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const ads = await db.ad.findMany({ where: { tenantId: req.tenant.id }, include: { product: { select: { id: true, name: true } } } });

  const data = await Promise.all(ads.map(async (ad) => {
    const [clicks, spendAgg, firstTouchOrders, lastTouchOrders] = await Promise.all([
      db.adClick.count({ where: { adId: ad.id, ...(from || to ? { timestamp: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) } }),
      db.adSpendDaily.aggregate({ where: { adId: ad.id, ...(from || to ? { date: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) }, _sum: { amount: true } }),
      db.order.count({ where: { tenantId: req.tenant.id, firstTouchAdId: ad.id, ...periodWhere(from, to), returns: { none: {} } } }),
      db.order.count({ where: { tenantId: req.tenant.id, lastTouchAdId: ad.id, ...periodWhere(from, to), returns: { none: {} } } }),
    ]);
    const spend = Number(spendAgg._sum.amount || 0);
    return {
      adId: ad.id,
      name: ad.name || ad.externalId || ad.id,
      productId: ad.productId,
      productName: ad.product?.name || null,
      clicks,
      purchasesFirstTouch: firstTouchOrders,
      purchasesLastTouch: lastTouchOrders,
      ctr: null, // імпресії не зберігаємо в моделі — CTR по кліках/показах порахувати нема з чого
      conversionFirstTouch: clicks > 0 ? firstTouchOrders / clicks : null,
      conversionLastTouch: clicks > 0 ? lastTouchOrders / clicks : null,
      spend,
      costPerPurchase: firstTouchOrders > 0 ? spend / firstTouchOrders : null,
    };
  }));
  res.json({ ok: true, data: data.sort((a, b) => b.spend - a.spend) });
}));

// ── §6.3 Маржа по товару (дохід − ProductExpense за період) ─────────────
router.get('/analytics/margin', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const fromDate = parseFrom(from);
  const toDate = parseTo(to);

  const products = await db.product.findMany({
    where: { tenantId: req.tenant.id },
    include: {
      productExpense: true,
      orderItems: { where: { order: { returns: { none: {} }, ...periodWhere(from, to) } } },
    },
  });

  const data = await Promise.all(products.map(async (p) => {
    const qty = p.orderItems.reduce((s, it) => s + it.quantity, 0);
    const revenue = p.orderItems.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
    const spendAgg = await db.adSpendDaily.aggregate({
      where: { ad: { tenantId: req.tenant.id, productId: p.id }, ...(fromDate || toDate ? { date: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) },
      _sum: { amount: true },
    });
    const adSpend = Number(spendAgg._sum.amount || 0);
    const cogs = Number(p.productExpense?.cogs || 0);
    const managerCostFixed = Number(p.productExpense?.managerCostFixed || 0);
    const managerCostPercent = Number(p.productExpense?.managerCostPercent || 0);
    const margin = revenue - cogs * qty - adSpend - managerCostFixed * qty - (revenue * managerCostPercent) / 100;
    return { productId: p.id, name: p.name, sku: p.sku, revenue, qty, adSpend, cogs: cogs * qty, managerCost: managerCostFixed * qty + (revenue * managerCostPercent) / 100, margin, marginPercent: revenue > 0 ? (margin / revenue) * 100 : null };
  }));
  res.json({ ok: true, data: data.filter((r) => r.qty > 0).sort((a, b) => b.margin - a.margin) });
}));

// ── §6.4 Допродажі ────────────────────────────────────────────────────────
// Примітка: модель не фіксує «запропоновано, але відхилено» — acceptanceRate тут це
// частка появи товару як допродажу серед усіх його появ у замовленнях (наближення з наявних даних).
router.get('/analytics/upsells', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const orders = await db.order.findMany({
    where: { tenantId: req.tenant.id, ...periodWhere(from, to), returns: { none: {} } },
    include: { items: { include: { product: { select: { id: true, name: true } } } } },
  });

  const pairCounts = new Map(); // "mainId|upsellId" -> {mainName, upsellName, count}
  const appearances = new Map(); // productId -> {name, total, asUpsell}

  for (const order of orders) {
    const mains = order.items.filter((it) => !it.isUpsell && it.productId);
    const upsells = order.items.filter((it) => it.isUpsell && it.productId);
    for (const it of order.items) {
      if (!it.productId) continue;
      const row = appearances.get(it.productId) || { productId: it.productId, name: it.product?.name || it.name, total: 0, asUpsell: 0 };
      row.total += 1;
      if (it.isUpsell) row.asUpsell += 1;
      appearances.set(it.productId, row);
    }
    for (const main of mains) {
      for (const up of upsells) {
        const key = `${main.productId}|${up.productId}`;
        const row = pairCounts.get(key) || { mainProductId: main.productId, mainName: main.product?.name || main.name, upsellProductId: up.productId, upsellName: up.product?.name || up.name, count: 0 };
        row.count += 1;
        pairCounts.set(key, row);
      }
    }
  }

  const topPairs = [...pairCounts.values()].sort((a, b) => b.count - a.count).slice(0, 50);
  const acceptance = [...appearances.values()]
    .filter((r) => r.asUpsell > 0)
    .map((r) => ({ ...r, acceptanceRate: r.total > 0 ? (r.asUpsell / r.total) * 100 : 0 }))
    .sort((a, b) => b.acceptanceRate - a.acceptanceRate);

  res.json({ ok: true, data: { topPairs, acceptance } });
}));

// ── §6.5 Середній час від кліку до покупки ───────────────────────────────
router.get('/analytics/time-to-purchase', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const orders = await db.order.findMany({
    where: { tenantId: req.tenant.id, firstTouchAt: { not: null }, ...periodWhere(from, to), returns: { none: {} } },
    select: { id: true, createdAt: true, firstTouchAt: true, firstTouchAdId: true, items: { select: { productId: true }, take: 1 } },
  });
  const diffsMinutes = orders.map((o) => (o.createdAt.getTime() - o.firstTouchAt.getTime()) / 60000);
  const overall = summarize(diffsMinutes);

  const byAd = groupSummarize(orders.map((o) => ({ key: o.firstTouchAdId, minutes: (o.createdAt.getTime() - o.firstTouchAt.getTime()) / 60000 })));
  const byProduct = groupSummarize(orders.map((o) => ({ key: o.items[0]?.productId || null, minutes: (o.createdAt.getTime() - o.firstTouchAt.getTime()) / 60000 })).filter((x) => x.key));

  res.json({ ok: true, data: { overall, byAd, byProduct } });
}));

function summarize(values) {
  if (!values.length) return { count: 0, avgMinutes: null, medianMinutes: null };
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { count: values.length, avgMinutes: avg, medianMinutes: median };
}

function groupSummarize(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const arr = byKey.get(r.key) || [];
    arr.push(r.minutes);
    byKey.set(r.key, arr);
  }
  return [...byKey.entries()].map(([key, values]) => ({ key, ...summarize(values) })).sort((a, b) => (a.avgMinutes ?? 0) - (b.avgMinutes ?? 0));
}

module.exports = router;
