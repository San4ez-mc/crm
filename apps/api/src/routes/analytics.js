// §6 Аналітика — 5 звітів, кожен з фільтром період (+ товар/реклама де доречно).
// Скрізь виключаємо замовлення, на які є Return (щоб маржа/конверсія не завищувались, §4.11).
// Органічні звернення (без реклами) мають порожні firstTouchAdId/lastTouchAdId — виключаються
// з розрахунків по рекламі природно (§2, "AdClick для органічних звернень").
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { parseFrom, parseTo } = require('../lib/dateRange');
const { ValidationError } = require('@crm/errors');

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
// Два різних "кліки": AdClick — наші власні (перехід у діалог з реклами), AdSpendDaily.clicks/
// impressions — платформні метрики Meta (для CTR/CPC/CPM). revenueFirstTouch/roas — дохід із
// замовлень, де це оголошення було first-touch (без Return), ROAS = дохід/витрата.
router.get('/analytics/ads-conversion', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const ads = await db.ad.findMany({ where: { tenantId: req.tenant.id }, include: { product: { select: { id: true, name: true } } } });

  const data = await Promise.all(ads.map(async (ad) => {
    const [clicks, spendAgg, firstTouchOrders, lastTouchOrders, revenueOrders] = await Promise.all([
      db.adClick.count({ where: { adId: ad.id, ...(from || to ? { timestamp: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) } }),
      db.adSpendDaily.aggregate({ where: { adId: ad.id, ...(from || to ? { date: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) }, _sum: { amount: true, impressions: true, clicks: true } }),
      db.order.count({ where: { tenantId: req.tenant.id, firstTouchAdId: ad.id, ...periodWhere(from, to), returns: { none: {} } } }),
      db.order.count({ where: { tenantId: req.tenant.id, lastTouchAdId: ad.id, ...periodWhere(from, to), returns: { none: {} } } }),
      db.order.findMany({ where: { tenantId: req.tenant.id, firstTouchAdId: ad.id, ...periodWhere(from, to), returns: { none: {} } }, select: { items: { select: { price: true, quantity: true } } } }),
    ]);
    const spend = Number(spendAgg._sum.amount || 0);
    const impressions = Number(spendAgg._sum.impressions || 0);
    const platformClicks = Number(spendAgg._sum.clicks || 0);
    const revenueFirstTouch = revenueOrders.reduce((sum, o) => sum + o.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0), 0);
    return {
      adId: ad.id,
      name: ad.name || ad.externalId || ad.id,
      productId: ad.productId,
      productName: ad.product?.name || null,
      clicks,
      purchasesFirstTouch: firstTouchOrders,
      purchasesLastTouch: lastTouchOrders,
      impressions: impressions || null,
      platformClicks: platformClicks || null,
      ctr: impressions > 0 ? (platformClicks / impressions) * 100 : null,
      cpc: platformClicks > 0 ? spend / platformClicks : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      conversionFirstTouch: clicks > 0 ? firstTouchOrders / clicks : null,
      conversionLastTouch: clicks > 0 ? lastTouchOrders / clicks : null,
      spend,
      costPerPurchase: firstTouchOrders > 0 ? spend / firstTouchOrders : null,
      revenueFirstTouch,
      roas: spend > 0 ? revenueFirstTouch / spend : null,
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

// ── Щоденні звіти («Рука на пульсі») — доповнення 2026-08-31 ────────────────
// Маржа per-order = дохід − cogs − managerCost (той самий підхід, що /analytics/margin
// і /product-expenses), АЛЕ без відрахування рекламного бюджету — рекламу віднімаємо
// окремо на рівні "Прибуток", щоб не рахувати її двічі. Фінансові наслідки відмови
// (хто платить за зворотну доставку) ще НЕ визначені (чекаємо правил від Олексія) —
// тут відмова лише виключає замовлення з "успішної" виручки, без додаткових штрафів.
function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function marginPerOrderItem(item, expenseByProduct) {
  const exp = item.productId ? expenseByProduct.get(item.productId) : null;
  const cogs = Number(exp?.cogs || 0);
  const managerCostFixed = Number(exp?.managerCostFixed || 0);
  const managerCostPercent = Number(exp?.managerCostPercent || 0);
  const revenue = Number(item.price) * item.quantity;
  return revenue - cogs * item.quantity - managerCostFixed * item.quantity - (revenue * managerCostPercent) / 100;
}

async function loadExpenseMap(tenantId) {
  const rows = await db.productExpense.findMany({ where: { tenantId } });
  return new Map(rows.map((r) => [r.productId, r]));
}

// ── Щоденне зведення по всьому tenant (скріншот "День") ─────────────────
router.get('/analytics/daily', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const tenant = req.tenant;
  const expenseByProduct = await loadExpenseMap(tenant.id);

  const [orders, spendRows, clickRows, returns] = await Promise.all([
    db.order.findMany({
      where: { tenantId: tenant.id, ...periodWhere(from, to) },
      include: { items: true, buyer: { select: { id: true } } },
    }),
    db.adSpendDaily.findMany({ where: { ad: { tenantId: tenant.id }, ...(from || to ? { date: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) } }),
    db.adClick.findMany({ where: { ad: { tenantId: tenant.id }, ...(from || to ? { timestamp: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) } }),
    db.return.findMany({ where: { tenantId: tenant.id, ...(from || to ? { createdAt: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) } }),
  ]);

  // Для "новий/повторний клієнт" потрібна історія покупця ДО цього замовлення — рахуємо по всій базі, не тільки в періоді.
  const firstOrderAtByBuyer = new Map();
  for (const o of await db.order.findMany({ where: { tenantId: tenant.id, buyerId: { not: null } }, select: { buyerId: true, createdAt: true }, orderBy: { createdAt: 'asc' } })) {
    if (!firstOrderAtByBuyer.has(o.buyerId)) firstOrderAtByBuyer.set(o.buyerId, o.createdAt);
  }

  const days = new Map(); // dayKey -> accumulator
  function bucket(key) {
    if (!days.has(key)) {
      days.set(key, {
        date: key, ordersCount: 0, refusedCount: 0, marginNonRefusedTotal: 0, marginAllTotal: 0,
        qtySold: 0, qtyRepeat: 0, newBuyerOrders: 0,
      });
    }
    return days.get(key);
  }

  for (const order of orders) {
    const key = dayKey(order.createdAt);
    const b = bucket(key);
    b.ordersCount += 1;
    if (order.isRefused) b.refusedCount += 1;

    let orderMargin = 0;
    for (const item of order.items) {
      orderMargin += await marginPerOrderItem(item, expenseByProduct);
      if (!item.isUpsell) b.qtySold += item.quantity;
      const isRepeat = order.buyerId && firstOrderAtByBuyer.get(order.buyerId) && firstOrderAtByBuyer.get(order.buyerId).getTime() < order.createdAt.getTime();
      if (isRepeat) b.qtyRepeat += item.quantity;
    }
    b.marginAllTotal += orderMargin;
    if (!order.isRefused) b.marginNonRefusedTotal += orderMargin;

    const isNewBuyer = !order.buyerId || (firstOrderAtByBuyer.get(order.buyerId)?.getTime() === order.createdAt.getTime());
    if (isNewBuyer) b.newBuyerOrders += 1;
  }
  for (const spend of spendRows) {
    const b = bucket(dayKey(spend.date));
    b.adSpend = (b.adSpend || 0) + Number(spend.amount);
    b.impressions = (b.impressions || 0) + Number(spend.impressions || 0);
    b.platformClicks = (b.platformClicks || 0) + Number(spend.clicks || 0);
  }
  for (const click of clickRows) {
    const b = bucket(dayKey(click.timestamp));
    b.messages = (b.messages || 0) + 1;
  }
  for (const ret of returns) {
    const b = bucket(dayKey(ret.createdAt));
    b.returnsCount = (b.returnsCount || 0) + 1;
  }

  const usdRate = Number(tenant.usdExchangeRate || 0);
  const fixedCosts = Number(tenant.dailyFixedCosts || 0);
  const payrollCosts = Number(tenant.dailyPayrollCosts || 0);

  const data = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => {
    const adSpend = d.adSpend || 0;
    const messages = d.messages || 0;
    const impressions = d.impressions || 0;
    const platformClicks = d.platformClicks || 0;
    const profitExpected = d.marginNonRefusedTotal - adSpend - fixedCosts - payrollCosts;
    const profitNoPayroll = d.marginNonRefusedTotal - adSpend - fixedCosts;
    return {
      date,
      marginAvgNonRefused: d.ordersCount - d.refusedCount > 0 ? d.marginNonRefusedTotal / (d.ordersCount - d.refusedCount) : null,
      marginAvgWithRefused: d.ordersCount > 0 ? d.marginNonRefusedTotal / d.ordersCount : null,
      orderPrice: d.ordersCount > 0 ? adSpend / d.ordersCount : null, // "Ціна замовлення" = CPA
      profitPerClientNoPayroll: d.ordersCount > 0 ? profitNoPayroll / d.ordersCount : null,
      profitPerClientWithPayroll: d.ordersCount > 0 ? profitExpected / d.ordersCount : null,
      messagePrice: messages > 0 ? adSpend / messages : null, // CPL
      conversionToSale: messages > 0 ? d.ordersCount / messages : null,
      marginTotal: d.marginNonRefusedTotal,
      adSpend,
      newMessages: messages,
      qtySold: d.qtySold,
      qtyRepeat: d.qtyRepeat,
      clicks: platformClicks,
      impressions,
      roi: adSpend > 0 ? d.marginNonRefusedTotal / adSpend : null, // "Окупність"
      expectedProfit: profitExpected,
      usdExchangeRate: usdRate || null,
      refusalRate: d.ordersCount > 0 ? (d.refusedCount / d.ordersCount) * 100 : null,
      returnRate: d.ordersCount > 0 ? ((d.returnsCount || 0) / d.ordersCount) * 100 : null,
      dailyFixedCosts: fixedCosts,
      dailyPayrollCosts: payrollCosts,
      profitNoPayroll,
      newCustomerCost: d.newBuyerOrders > 0 ? adSpend / d.newBuyerOrders : null,
      cpc: platformClicks > 0 ? adSpend / platformClicks : null,
      ctr: impressions > 0 ? (platformClicks / impressions) * 100 : null,
      cpm: impressions > 0 ? (adSpend / impressions) * 1000 : null,
      repeatSalesRate: d.qtySold > 0 ? (d.qtyRepeat / d.qtySold) * 100 : null,
      ordersCount: d.ordersCount,
      refusedCount: d.refusedCount,
    };
  });

  res.json({ ok: true, data });
}));

// ── Щоденний звіт по одному товару (скріншот "Артикул") ─────────────────
router.get('/analytics/product-daily', asyncHandler(async (req, res) => {
  const { from, to, productId } = req.query;
  if (!productId) throw new (require('@crm/errors').ValidationError)('productId обовʼязковий');
  const tenant = req.tenant;
  const expenseByProduct = await loadExpenseMap(tenant.id);

  const [ads, orders] = await Promise.all([
    db.ad.findMany({ where: { tenantId: tenant.id, productId: String(productId) } }),
    db.order.findMany({
      where: { tenantId: tenant.id, items: { some: { productId: String(productId) } }, ...periodWhere(from, to) },
      include: { items: { where: { productId: String(productId) } } },
    }),
  ]);
  const adIds = ads.map((a) => a.id);

  const [spendRows, clickRows] = await Promise.all([
    db.adSpendDaily.findMany({ where: { adId: { in: adIds }, ...(from || to ? { date: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) } }),
    db.adClick.findMany({ where: { adId: { in: adIds }, ...(from || to ? { timestamp: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}) } }),
  ]);

  const days = new Map();
  function bucket(key) {
    if (!days.has(key)) days.set(key, { date: key, ordersCount: 0, refusedCount: 0, marginGrossTotal: 0, marginNetTotal: 0, adSpend: 0, messages: 0 });
    return days.get(key);
  }
  for (const order of orders) {
    const b = bucket(dayKey(order.createdAt));
    b.ordersCount += 1;
    if (order.isRefused) b.refusedCount += 1;
    let m = 0;
    for (const item of order.items) m += await marginPerOrderItem(item, expenseByProduct);
    b.marginGrossTotal += m; // "Маржа всього" — до врахування відмов
    if (!order.isRefused) b.marginNetTotal += m; // "...із відмовами" — фактична (виключені відмовлені)
  }
  for (const spend of spendRows) bucket(dayKey(spend.date)).adSpend += Number(spend.amount);
  for (const click of clickRows) bucket(dayKey(click.timestamp)).messages += 1;

  const usdRate = Number(tenant.usdExchangeRate || 0);
  const data = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => {
    const nonRefusedOrders = d.ordersCount - d.refusedCount;
    return {
      date,
      adSpend: d.adSpend,
      messages: d.messages,
      ordersCount: d.ordersCount,
      marginPerOrder: nonRefusedOrders > 0 ? d.marginNetTotal / nonRefusedOrders : null,
      marginTotal: d.marginGrossTotal, // "Маржа всього" — гросс, до відмов
      marginTotalWithRefused: d.marginNetTotal, // "...із відмовами" — фактична
      messagePrice: d.messages > 0 ? d.adSpend / d.messages : null,
      orderPrice: d.ordersCount > 0 ? d.adSpend / d.ordersCount : null,
      conversionToOrder: d.messages > 0 ? d.ordersCount / d.messages : null,
      refusalRate: d.ordersCount > 0 ? (d.refusedCount / d.ordersCount) * 100 : null,
      usdExchangeRate: usdRate || null,
      roi: d.adSpend > 0 ? d.marginNetTotal / d.adSpend : null,
      profit: d.marginNetTotal - d.adSpend,
    };
  });

  res.json({ ok: true, data });
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
