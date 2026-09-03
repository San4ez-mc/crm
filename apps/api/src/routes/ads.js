// §4.9 Ad / AdSpendDaily / AdClick + §9.13 Рекламні витрати.
// POST /ad-spend-daily і /ad-clicks — write-ендпойнти для окремої crontab-воронки FINEKO Flows,
// яка ходить у Zernio/Meta Ads API (§2, §5 ТЗ) — той самий Bearer tenant.apiKey.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { parseFrom, parseTo } = require('../lib/dateRange');
const { loadExpenseMap, marginPerOrderItem } = require('../lib/margin');

const router = express.Router();

// ── Спільний розрахунок для «Рекламні витрати»/детальної сторінки оголошення ─────
// (2026-09-03, за проханням власника): вся маржа ФАКТИЧНОГО кошика замовлення (навіть
// якщо там інші товари/допродажі) зараховується оголошенню, яке привело клієнта
// (firstTouchAdId) — так само як в /analytics/ads-conversion, просто тут ще й з
// виручкою/маржею, а не тільки лічильниками. "Забрано" = !isRefused; виручку/маржу
// рахуємо лише по неповернутих (без Return) і не-відмовлених замовленнях — так само,
// як решта аналітики виключає Return (§4.11), інакше цифри будуть завищені.
async function computeAdStats(tenantId, ad, dateWhere, expenseByProduct) {
  const [spendAgg, contacts, orders] = await Promise.all([
    db.adSpendDaily.aggregate({ where: { adId: ad.id, ...(dateWhere ? { date: dateWhere } : {}) }, _sum: { amount: true } }),
    db.adClick.count({ where: { adId: ad.id, ...(dateWhere ? { timestamp: dateWhere } : {}) } }),
    db.order.findMany({
      where: { tenantId, firstTouchAdId: ad.id, ...(dateWhere ? { createdAt: dateWhere } : {}) },
      select: {
        id: true, createdAt: true, isRefused: true,
        returns: { select: { id: true } },
        items: { select: { productId: true, name: true, price: true, quantity: true, product: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const spend = Number(spendAgg._sum.amount || 0);
  const ordersCreated = orders.length;
  const pickedUp = orders.filter((o) => !o.isRefused);
  const ordersPickedUp = pickedUp.length;
  const refusedCount = ordersCreated - ordersPickedUp;
  const revenueOrders = pickedUp.filter((o) => o.returns.length === 0); // "фактична" виручка — без відмов і без повернень

  let revenue = 0, margin = 0;
  const productsMap = new Map(); // productId||name -> {name, qty}
  const orderRows = [];
  for (const o of orders) {
    let orderRevenue = 0, orderMargin = 0;
    for (const it of o.items) {
      orderRevenue += Number(it.price) * it.quantity;
      orderMargin += marginPerOrderItem(it, expenseByProduct);
    }
    if (revenueOrders.includes(o)) {
      revenue += orderRevenue;
      margin += orderMargin;
      for (const it of o.items) {
        const key = it.productId || it.name;
        const row = productsMap.get(key) || { name: it.product?.name || it.name, qty: 0 };
        row.qty += it.quantity;
        productsMap.set(key, row);
      }
    }
    orderRows.push({
      id: o.id,
      createdAt: o.createdAt,
      itemsLabel: o.items.map((it) => it.product?.name || it.name).join(', ') || '—',
      status: o.isRefused ? 'refused' : (o.returns.length > 0 ? 'returned' : 'picked_up'),
      revenue: orderRevenue,
      margin: orderMargin,
    });
  }

  const profit = margin - spend;
  return {
    adId: ad.id,
    spend,
    contacts,
    ordersCreated,
    ordersPickedUp,
    refusedCount,
    revenue,
    margin,
    profit,
    roi: spend > 0 ? margin / spend : null,
    romi: spend > 0 ? (profit / spend) * 100 : null,
    costPerContact: contacts > 0 ? spend / contacts : null,
    cpa: ordersCreated > 0 ? spend / ordersCreated : null,
    cpaPickedUp: ordersPickedUp > 0 ? spend / ordersPickedUp : null,
    conversionToOrder: contacts > 0 ? (ordersCreated / contacts) * 100 : null,
    pickupRate: ordersCreated > 0 ? (ordersPickedUp / ordersCreated) * 100 : null,
    avgCheck: ordersPickedUp > 0 ? revenue / ordersPickedUp : null,
    avgMargin: ordersPickedUp > 0 ? margin / ordersPickedUp : null,
    products: [...productsMap.values()].sort((a, b) => b.qty - a.qty),
    orders: orderRows,
  };
}

function periodDateWhere(from, to) {
  if (!from && !to) return null;
  return { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) };
}

// §9.13 — картка оголошення (не залежить від дати: назва/фото/привʼязка товару стабільні,
// на відміну від AdSpendDaily, де та сама прив'язка інакше довелось би повторювати на
// кожному денному рядку). Разом віддаємо агреговані totalSpend/lastSyncedAt.
router.get('/ads', asyncHandler(async (req, res) => {
  const { productId, take = '100', skip = '0' } = req.query;
  const where = { tenantId: req.tenant.id, ...(productId ? { productId: String(productId) } : {}) };
  const ads = await db.ad.findMany({
    where,
    include: { product: { select: { id: true, name: true } }, _count: { select: { spendDaily: true } } },
    orderBy: { createdAt: 'desc' },
    take: Number(take),
    skip: Number(skip),
  });
  const totals = await db.adSpendDaily.groupBy({
    by: ['adId'],
    where: { adId: { in: ads.map((a) => a.id) } },
    _sum: { amount: true, impressions: true, clicks: true },
    _max: { date: true },
  });
  const totalsByAd = Object.fromEntries(totals.map((t) => {
    const spend = Number(t._sum.amount || 0);
    const impressions = Number(t._sum.impressions || 0);
    const clicks = Number(t._sum.clicks || 0);
    return [t.adId, {
      totalSpend: t._sum.amount,
      lastSyncedAt: t._max.date,
      impressions: impressions || null,
      clicks: clicks || null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      cpc: clicks > 0 ? spend / clicks : null,
    }];
  }));
  res.json({ ok: true, data: ads.map((a) => ({ ...a, spendDailyCount: a._count.spendDaily, _count: undefined, ...(totalsByAd[a.id] || { totalSpend: 0, lastSyncedAt: null, impressions: null, clicks: null, ctr: null, cpc: null }) })) });
}));

router.post('/ads', asyncHandler(async (req, res) => {
  const { externalId, name, productId, campaignId, campaignName, adAccountId } = req.body || {};
  const ad = await db.ad.create({
    data: {
      tenantId: req.tenant.id, externalId: externalId || null, name: name || null, productId: productId || null,
      campaignId: campaignId || null, campaignName: campaignName || null, adAccountId: adAccountId || null,
    },
  });
  res.status(201).json({ ok: true, data: ad });
}));

// Прив'язка оголошення до товару — inline-редагування в §9.13 (рядки без товару підсвічені).
router.patch('/ads/:id', asyncHandler(async (req, res) => {
  const existing = await db.ad.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Ad', req.params.id);
  const { productId, name } = req.body || {};
  const ad = await db.ad.update({
    where: { id: existing.id },
    data: { ...(productId !== undefined ? { productId: productId || null } : {}), ...(name !== undefined ? { name } : {}) },
    include: { product: { select: { id: true, name: true } } },
  });
  res.json({ ok: true, data: ad });
}));

// §9.13 таблиця дата×кабінет/оголошення×товар×сума — з agregацією по AdSpendDaily.
router.get('/ad-spend', asyncHandler(async (req, res) => {
  const { from, to, productId, take = '200', skip = '0' } = req.query;
  const where = {
    ad: { tenantId: req.tenant.id, ...(productId ? { productId: String(productId) } : {}) },
    ...(from || to ? { date: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    db.adSpendDaily.findMany({ where, include: { ad: { include: { product: { select: { id: true, name: true } } } } }, orderBy: { date: 'desc' }, take: Number(take), skip: Number(skip) }),
    db.adSpendDaily.count({ where }),
  ]);
  res.json({ ok: true, data: items, meta: { total, take: Number(take), skip: Number(skip) } });
}));

// «Рекламні витрати» (2026-09-03, редизайн за референсом власника) — список оголошень
// з витратою/замовленнями/окупністю/прибутком за обраний період, з пошуком.
router.get('/ads/spend-summary', asyncHandler(async (req, res) => {
  const { from, to, search, take = '10', skip = '0' } = req.query;
  const dateWhere = periodDateWhere(from, to);
  const where = {
    tenantId: req.tenant.id,
    ...(search ? { OR: [{ name: { contains: String(search), mode: 'insensitive' } }, { externalId: { contains: String(search) } }] } : {}),
  };
  const [ads, total] = await Promise.all([
    db.ad.findMany({ where, include: { product: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }),
    db.ad.count({ where }),
  ]);
  const expenseByProduct = await loadExpenseMap(req.tenant.id);
  const all = await Promise.all(ads.map((ad) => computeAdStats(req.tenant.id, ad, dateWhere, expenseByProduct)));
  const statsByAd = new Map(all.map((s) => [s.adId, s]));

  const totals = all.reduce((acc, s) => {
    acc.spend += s.spend; acc.margin += s.margin; acc.orders += s.ordersCreated;
    if (s.spend > 0) acc.activeAds += 1;
    return acc;
  }, { spend: 0, margin: 0, orders: 0, activeAds: 0 });

  const rows = ads.map((ad) => ({
    id: ad.id, name: ad.name, externalId: ad.externalId, thumbnailUrl: ad.thumbnailUrl, campaignName: ad.campaignName,
    productId: ad.productId, productName: ad.product?.name || null,
    ...statsByAd.get(ad.id),
  }));
  const paged = rows.slice(Number(skip), Number(skip) + Number(take));

  res.json({
    ok: true,
    data: paged,
    meta: { total, take: Number(take), skip: Number(skip) },
    totals: { activeAds: totals.activeAds, spend: totals.spend, orders: totals.orders, roi: totals.spend > 0 ? totals.margin / totals.spend : null },
  });
}));

// Детальна аналітика одного оголошення (drill-down з «Рекламні витрати»).
router.get('/ads/:id/detail', asyncHandler(async (req, res) => {
  const ad = await db.ad.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { product: { select: { id: true, name: true } } } });
  if (!ad) throw new NotFoundError('Ad', req.params.id);
  const { from, to } = req.query;
  const dateWhere = periodDateWhere(from, to);
  const expenseByProduct = await loadExpenseMap(req.tenant.id);
  const stats = await computeAdStats(req.tenant.id, ad, dateWhere, expenseByProduct);

  // Тренд по днях — та сама межа періоду, спред по днях (спенд з AdSpendDaily, маржа з
  // замовлень, створених того дня, по тій самій "фактичній" логіці — не відмова, без Return).
  const [spendRows, orders] = await Promise.all([
    db.adSpendDaily.findMany({ where: { adId: ad.id, ...(dateWhere ? { date: dateWhere } : {}) }, select: { date: true, amount: true } }),
    db.order.findMany({
      where: { tenantId: req.tenant.id, firstTouchAdId: ad.id, ...(dateWhere ? { createdAt: dateWhere } : {}), isRefused: false, returns: { none: {} } },
      select: { createdAt: true, items: { select: { productId: true, price: true, quantity: true } } },
    }),
  ]);
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const days = new Map();
  const bucket = (k) => { if (!days.has(k)) days.set(k, { date: k, spend: 0, margin: 0 }); return days.get(k); };
  for (const row of spendRows) bucket(dayKey(row.date)).spend += Number(row.amount);
  for (const o of orders) {
    const b = bucket(dayKey(o.createdAt));
    for (const it of o.items) b.margin += marginPerOrderItem(it, expenseByProduct);
  }
  const trend = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, profit: d.margin - d.spend }));

  res.json({
    ok: true,
    data: {
      ad: { id: ad.id, name: ad.name, externalId: ad.externalId, thumbnailUrl: ad.thumbnailUrl, campaignName: ad.campaignName, productId: ad.productId, productName: ad.product?.name || null },
      ...stats,
      trend,
    },
  });
}));

// ДОПОВНЕННЯ 2026-09-01 — кнопка "Отримати дані зараз" на сторінці реклами: тригерить
// відповідну cron-воронку Flows (Meta Ads Sync) прямо зараз, не чекаючи щоденний крон.
// botId per-tenant зберігається як TenantSecret FLOWS_META_SYNC_BOT_ID (заповнюється вручну
// один раз при підключенні магазину). FLOWS_API_URL/FLOWS_API_SECRET — системні, у .env,
// той самий X-Api-Secret механізм, яким платформа Flows сама себе авторизує служебно.
router.post('/ad-spend/sync-now', asyncHandler(async (req, res) => {
  const secret = await db.tenantSecret.findFirst({ where: { tenantId: req.tenant.id, key: 'FLOWS_META_SYNC_BOT_ID' } });
  if (!secret?.value) throw new ValidationError('Не налаштовано FLOWS_META_SYNC_BOT_ID для цього магазину (Ключі API)');
  if (!process.env.FLOWS_API_URL || !process.env.FLOWS_API_SECRET) throw new ValidationError('FLOWS_API_URL/FLOWS_API_SECRET не налаштовані на сервері CRM');

  const resp = await fetch(`${process.env.FLOWS_API_URL}/api/sessions/test/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Secret': process.env.FLOWS_API_SECRET },
    body: JSON.stringify({ botId: secret.value }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) throw new ValidationError('Flows не відповів успіхом: ' + (json?.error?.message || json?.error || resp.status));

  const snap = json.data?.contextSnapshot || {};
  res.json({ ok: true, data: { status: snap.metaSyncStatus || 'unknown', date: snap.metaSyncDate || null, adsCount: snap.metaSyncAdsCount ?? null, written: snap.metaSyncWritten ?? null, error: snap.metaSyncError || null } });
}));

async function findOrCreateAdByExternalId(tenantId, externalId, name, meta = {}) {
  let ad = await db.ad.findFirst({ where: { tenantId, externalId } });
  if (!ad) {
    ad = await db.ad.create({
      data: { tenantId, externalId, name: name || null, campaignId: meta.campaignId || null, campaignName: meta.campaignName || null, adAccountId: meta.adAccountId || null, thumbnailUrl: meta.thumbnailUrl || null },
    });
  } else if (meta.campaignName || meta.campaignId || meta.adAccountId || meta.thumbnailUrl) {
    // Meta не міняє campaignId/adAccountId заднім числом, але назва кампанії/фото креативу могли оновитись.
    ad = await db.ad.update({
      where: { id: ad.id },
      data: { ...(meta.campaignId ? { campaignId: meta.campaignId } : {}), ...(meta.campaignName ? { campaignName: meta.campaignName } : {}), ...(meta.adAccountId ? { adAccountId: meta.adAccountId } : {}), ...(meta.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}) },
    });
  }
  return ad;
}

// §5: `POST /ad-spend-daily` — щоденні витрати від Flows-автоматизації (Zernio/Meta Ads).
// impressions/clicks — платформні метрики самого Facebook (для CPC/CTR/CPM), не наш AdClick.
router.post('/ad-spend-daily', asyncHandler(async (req, res) => {
  const { externalId, adId, name, date, amount, currency, impressions, clicks, campaignId, campaignName, adAccountId, thumbnailUrl } = req.body || {};
  if (!date || amount === undefined) throw new ValidationError('date і amount обовʼязкові');
  const ad = adId
    ? await db.ad.findFirst({ where: { id: adId, tenantId: req.tenant.id } })
    : await findOrCreateAdByExternalId(req.tenant.id, String(externalId || 'unknown'), name, { campaignId, campaignName, adAccountId, thumbnailUrl });
  if (!ad) throw new NotFoundError('Ad', adId);
  const row = await db.adSpendDaily.upsert({
    where: { adId_date: { adId: ad.id, date: new Date(date) } },
    update: { amount, currency: currency || 'UAH', ...(impressions !== undefined ? { impressions: Number(impressions) } : {}), ...(clicks !== undefined ? { clicks: Number(clicks) } : {}) },
    create: { adId: ad.id, date: new Date(date), amount, currency: currency || 'UAH', impressions: impressions !== undefined ? Number(impressions) : null, clicks: clicks !== undefined ? Number(clicks) : null },
  });
  res.status(201).json({ ok: true, data: row });
}));

// §5: `POST /ad-clicks` — подія кліку, перше повідомлення нової сесії воронки з entryAd.
router.post('/ad-clicks', asyncHandler(async (req, res) => {
  const { externalId, adId, name, sessionId, timestamp } = req.body || {};
  const ad = adId
    ? await db.ad.findFirst({ where: { id: adId, tenantId: req.tenant.id } })
    : await findOrCreateAdByExternalId(req.tenant.id, String(externalId || 'unknown'), name);
  if (!ad) throw new NotFoundError('Ad', adId);
  const click = await db.adClick.create({ data: { adId: ad.id, sessionId: sessionId || null, timestamp: timestamp ? new Date(timestamp) : undefined } });
  res.status(201).json({ ok: true, data: click });
}));

module.exports = router;
