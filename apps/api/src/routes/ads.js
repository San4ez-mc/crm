// §4.9 Ad / AdSpendDaily / AdClick + §9.13 Рекламні витрати.
// POST /ad-spend-daily і /ad-clicks — write-ендпойнти для окремої crontab-воронки FINEKO Flows,
// яка ходить у Zernio/Meta Ads API (§2, §5 ТЗ) — той самий Bearer tenant.apiKey.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { parseFrom, parseTo, kyivDayKey } = require('../lib/dateRange');
const { loadExpenseMap, marginPerOrderItem, ORDER_PLACED_WHERE, REAL_SALE_ORDER_WHERE, LEAD_WHERE } = require('../lib/margin');
const { findOrCreateAdByExternalId } = require('../lib/adAttribution');
const { ensureFreshUsdRate, rowToUAH } = require('../lib/currency');

const router = express.Router();

// ── Спільний розрахунок для «Рекламні витрати»/детальної сторінки оголошення ─────
// (2026-09-03, за проханням власника): вся маржа ФАКТИЧНОГО кошика замовлення (навіть
// якщо там інші товари/допродажі) зараховується оголошенню, яке привело клієнта
// (firstTouchAdId) — так само як в /analytics/ads-conversion, просто тут ще й з
// виручкою/маржею, а не тільки лічильниками. "Забрано" = !isRefused; виручку/маржу
// рахуємо лише по неповернутих (без Return) і не-відмовлених замовленнях — так само,
// як решта аналітики виключає Return (§4.11), інакше цифри будуть завищені.
// 2026-10-05: дані завантажуються ПАКЕТОМ на всі оголошення (3 агреговані запити), а не 3 запити на кожне
// одночасно — на ~1700 оголошеннях це вичерпувало пул зʼєднань Prisma і валило весь CRM (сторінки «Аналітика»,
// «Рекламні витрати»). Розрахунок по оголошенню — чиста функція statsFromData.
async function computeAdStatsBatch(tenantId, ads, dateWhere, expenseByProduct, usdRate) {
  if (!ads.length) return [];
  const ids = ads.map((a) => a.id);
  const one = ids.length === 1;
  const [spendRows, clickRows, orders] = await Promise.all([
    // Meta пише суму у $ — конвертуємо в грн, щоб margin/spend (ROI) не змішували валюти
    // (2026-09-07, фідбек власника).
    db.adSpendDaily.groupBy({ by: ['adId', 'currency'], where: { ...(one ? { adId: ids[0] } : { ad: { tenantId } }), ...(dateWhere ? { date: dateWhere } : {}) }, _sum: { amount: true } }),
    // Контакти = розмови, що почались із цієї реклами (картки воронки, lib/margin LEAD_WHERE); раніше — порожня AdClick.
    db.order.groupBy({ by: ['firstTouchAdId'], where: { tenantId, firstTouchAdId: one ? ids[0] : { not: null }, ...LEAD_WHERE, ...(dateWhere ? { createdAt: dateWhere } : {}) }, _count: { _all: true } })
      .then((rows) => rows.map((r) => ({ adId: r.firstTouchAdId, _count: r._count }))),
    // Замовлення = оформлені (є покупець), не картки розмов, яким бот лише показав товар.
    db.order.findMany({
      where: { tenantId, firstTouchAdId: one ? ids[0] : { not: null }, ...ORDER_PLACED_WHERE, ...(dateWhere ? { createdAt: dateWhere } : {}) },
      select: {
        id: true, createdAt: true, isRefused: true, firstTouchAdId: true,
        returns: { select: { id: true } },
        items: { select: { productId: true, name: true, price: true, quantity: true, product: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const spendBy = new Map();
  for (const r of spendRows) spendBy.set(r.adId, (spendBy.get(r.adId) || 0) + rowToUAH(r._sum.amount, r.currency, usdRate));
  const clicksBy = new Map(clickRows.map((r) => [r.adId, r._count._all]));
  const ordersBy = new Map();
  for (const o of orders) { const l = ordersBy.get(o.firstTouchAdId) || []; l.push(o); ordersBy.set(o.firstTouchAdId, l); }
  return ads.map((ad) => statsFromData(ad, spendBy.get(ad.id) || 0, clicksBy.get(ad.id) || 0, ordersBy.get(ad.id) || [], expenseByProduct));
}

async function computeAdStats(tenantId, ad, dateWhere, expenseByProduct, usdRate) {
  return (await computeAdStatsBatch(tenantId, [ad], dateWhere, expenseByProduct, usdRate))[0];
}

function statsFromData(ad, spend, contacts, orders, expenseByProduct) {
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
      orderMargin += marginPerOrderItem(it, expenseByProduct, o.isRefused, o.createdAt);
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
// Список рекламних кабінетів, реально присутніх у /ads — для мультивибору на сторінці
// (2026-09-13, живий баг: "я не знаю, звідки підтягнуло ці оголошення" — Meta-токен бачить
// кілька кабінетів одночасно, синк тепер тягне з УСІХ, тож на сторінці потрібен фільтр,
// щоб розрізнити, з якого саме кабінету яке оголошення).
router.get('/ads/accounts', asyncHandler(async (req, res) => {
  const rows = await db.ad.groupBy({ by: ['adAccountId', 'adAccountName'], where: { tenantId: req.tenant.id, NOT: { adAccountId: null } }, _count: { _all: true } });
  res.json({ ok: true, data: rows.map((r) => ({ adAccountId: r.adAccountId, adAccountName: r.adAccountName, count: r._count._all })).sort((a, b) => b.count - a.count) });
}));

router.get('/ads', asyncHandler(async (req, res) => {
  const { productId, externalId, adAccountId, status, search, take = '100', skip = '0' } = req.query;
  const tenant = await ensureFreshUsdRate(req.tenant);
  const usdRate = Number(tenant.usdExchangeRate || 0);
  // externalId — точковий пошук (2026-09-13, живий баг "дублі реклами" + "olgakovalenko_ok
  // отримала не той товар" — Пріоритет 0 в n_lookup-crm-code.js): виклик з воронки перевіряв
  // дублікат/шукав ручну прив'язку серед top-300 /ads client-side — стара реклама поза цим
  // вікном ставала невидимою. Точковий запит по externalId не залежить від розміру таблиці.
  // adAccountId — кома-розділений список (мультивибір кабінету на сторінці "Оголошення").
  const acctIds = adAccountId ? String(adAccountId).split(',').map((s) => s.trim()).filter(Boolean) : [];
  // status — за замовчуванням "лише активні" (власник: "на сторінці оголошень дійсно треба щоб
  // попадали тільки активні реклами, а не всі 1000" — рік+ старих паузнутих кампаній засмічував
  // сторінку). АЛЕ: точковий пошук по externalId (матчинг воронки, дедуп) НІКОЛИ не має
  // фільтруватись за статусом — органічна реклама/пост лишається дійсною прив'язкою назавжди,
  // незалежно від поточного статусу кампанії в Meta. `?status=all` — явний запит показати все.
  const statusFilter = (!externalId && status !== 'all') ? { OR: [{ effectiveStatus: 'ACTIVE' }, { effectiveStatus: null }] } : {};
  const where = {
    tenantId: req.tenant.id,
    ...(productId ? { productId: String(productId) } : {}),
    ...(externalId ? { externalId: String(externalId) } : {}),
    ...(acctIds.length ? { adAccountId: { in: acctIds } } : {}),
    // search — вибір реклами для замовлення вручну (картка замовлення, 2026-10-06): назва, кампанія або Meta-id.
    ...(search ? { AND: [{ OR: [{ name: { contains: String(search), mode: 'insensitive' } }, { campaignName: { contains: String(search), mode: 'insensitive' } }, { externalId: { contains: String(search) } }] }] } : {}),
    ...statusFilter,
  };
  const ads = await db.ad.findMany({
    where,
    include: { product: { select: { id: true, name: true } }, _count: { select: { spendDaily: true } } },
    // 2026-09-13 (власник: "щоб реклами виводились по даті запуску, якраз тоді я зверху буду
    // бачити правильні реклами"): adCreatedAt = Meta created_time (реальна дата ЗАПУСКУ), НЕ
    // createdAt (коли рядок з'явився в CRM — органічна реєстрація могла статись через тиждень
    // після реального запуску). Nulls last — оголошення без adCreatedAt (органічні, синк ще не
    // торкався) падають У КІНЕЦЬ, сортовані за власним createdAt між собою.
    orderBy: [{ adCreatedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: Number(take),
    skip: Number(skip),
  });
  // by adId+currency (не лише adId) — Meta пише $, конвертуємо в грн перед підсумком per-ad.
  const [totalsByAdCurrency, otherTotals] = await Promise.all([
    db.adSpendDaily.groupBy({ by: ['adId', 'currency'], where: { adId: { in: ads.map((a) => a.id) } }, _sum: { amount: true } }),
    db.adSpendDaily.groupBy({ by: ['adId'], where: { adId: { in: ads.map((a) => a.id) } }, _sum: { impressions: true, clicks: true }, _max: { date: true } }),
  ]);
  const spendByAd = new Map();
  for (const t of totalsByAdCurrency) spendByAd.set(t.adId, (spendByAd.get(t.adId) || 0) + rowToUAH(t._sum.amount, t.currency, usdRate));
  const totalsByAd = Object.fromEntries(otherTotals.map((t) => {
    const spend = spendByAd.get(t.adId) || 0;
    const impressions = Number(t._sum.impressions || 0);
    const clicks = Number(t._sum.clicks || 0);
    return [t.adId, {
      totalSpend: spend,
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
  // 2026-09-10 (фідбек власника, "чому фото не отримались?"): органічні оголошення, які
  // n_lookup-crm-code.js реєструє на льоту при першому кліку клієнта (ще до щоденної
  // синхронізації Meta Ads, яка знає лише про платні кампанії), раніше не мали фото
  // взагалі — thumbnailUrl тут просто не приймався, навіть якщо його прислали.
  const { postId, postUrl, externalId, name, campaignId, campaignName, adSetId, adSetName, adAccountId, adAccountName, effectiveStatus, adCreatedAt, thumbnailUrl, captionText, videoUrl, mediaType, productLinkSource, productLinkNote } = req.body || {};
  let { productId } = req.body || {};
  const _isAuto = /^auto_/.test(String(productLinkSource || ''));
  const _adCreatedAtDate = adCreatedAt ? new Date(adCreatedAt) : null;
  // 2026-09-13 (власник, живий баг "реклама приходить по кілька разів"): цей роут раніше
  // БЕЗУМОВНО створював новий рядок навіть для ВЖЕ ІСНУЮЧОГО externalId — виклик з
  // n_lookup-crm-code.js перевіряв дублікат лише серед 300 найновіших /ads (client-side),
  // і стара реклама, що випала з цього вікна через ріст таблиці, штампувала дублікати щоразу,
  // коли на неї писав НОВИЙ клієнт. Тепер — findFirst-or-update тут САМЕ (defense in depth,
  // незалежно від того, чи виправлено виклик на стороні воронки).
  let ad = externalId ? await db.ad.findFirst({ where: { tenantId: req.tenant.id, externalId: String(externalId) } }) : null;
  // Автоприв'язка ніколи не перезаписує вже прив'язаний товар (ручний вибір адміна головніший).
  if (_isAuto && ad && ad.productId) productId = undefined;
  let _linkMeta = (productId && _isAuto) ? { productLinkSource, productLinkNote: productLinkNote ? String(productLinkNote).slice(0, 300) : null } : {};
  // Невдала спроба автоприв'язки (auto_none) — лише позначка з причиною, товар не чіпаємо; на вже прив'язаних не пишемо.
  if (productLinkSource === 'auto_none' && !(ad && ad.productId)) { productId = undefined; _linkMeta = { productLinkSource, productLinkNote: productLinkNote ? String(productLinkNote).slice(0, 300) : null }; }
  if (ad) {
    ad = await db.ad.update({
      where: { id: ad.id },
      data: {
        ...(name ? { name } : {}),
        ...(productId !== undefined ? { productId: productId || null } : {}),
        ..._linkMeta,
        ...(campaignId ? { campaignId } : {}),
        ...(campaignName ? { campaignName } : {}),
        ...(adSetId ? { adSetId } : {}),
        ...(adSetName ? { adSetName } : {}),
        ...(adAccountId ? { adAccountId } : {}),
        ...(adAccountName ? { adAccountName } : {}),
        ...(effectiveStatus ? { effectiveStatus } : {}),
        ...(_adCreatedAtDate ? { adCreatedAt: _adCreatedAtDate } : {}),
        // 2026-09-17 (власник: "зламане фото" на вже засинхронених оголошеннях): thumbnail_url —
        // ТИМЧАСОВЕ підписане посилання Meta, яке з часом протухає. Раніше "не затираємо вже
        // наявне фото гіршим/порожнім" означало НІКОЛИ не оновлювати після першого запису — тому
        // протухле посилання лишалось зламаним назавжди. Кожен синк дає СВІЖЕ, зараз-дійсне
        // посилання — оновлюємо завжди (лише не затираємо на порожнє, якщо цього разу Meta його
        // не повернула).
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(captionText ? { captionText } : {}),
        ...(videoUrl ? { videoUrl } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(postId ? { postId: String(postId) } : {}),
        ...(postUrl ? { postUrl: String(postUrl) } : {}),
      },
    });
    return void res.status(200).json({ ok: true, data: ad, reused: true });
  }
  ad = await db.ad.create({
    data: {
      tenantId: req.tenant.id, externalId: externalId || null, name: name || null, productId: productId || null, ..._linkMeta,
      campaignId: campaignId || null, campaignName: campaignName || null, adSetId: adSetId || null, adSetName: adSetName || null,
      adAccountId: adAccountId || null, adAccountName: adAccountName || null, effectiveStatus: effectiveStatus || null,
      adCreatedAt: _adCreatedAtDate, thumbnailUrl: thumbnailUrl || null,
      captionText: captionText || null, videoUrl: videoUrl || null, mediaType: mediaType || null, postId: postId ? String(postId) : null, postUrl: postUrl ? String(postUrl) : null,
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
    data: { ...(productId !== undefined ? { productId: productId || null, productLinkSource: productId ? 'manual' : null, productLinkNote: null } : {}), ...(name !== undefined ? { name } : {}) },
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
// 2026-10-03: «що зараз рекламується» — для бота, коли Zernio не передав, з якої реклами клієнт (≈22% розмов). Активні реклами
// з товаром, згруповані за товаром: розмови й витрати за останні N днів (щоденна синхронізація з Meta), категорія, мініатюра.
router.get('/ads/active-summary', asyncHandler(async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 3));
  const since = new Date(Date.now() - days * 86400000); since.setUTCHours(0, 0, 0, 0);
  const ads = await db.ad.findMany({
    where: { tenantId: req.tenant.id, effectiveStatus: 'ACTIVE', productId: { not: null } },
    select: { id: true, name: true, thumbnailUrl: true, product: { select: { id: true, sku: true, name: true, customerName: true, isSet: true, outOfStock: true, category: { select: { id: true, name: true } } } }, spendDaily: { where: { date: { gte: since } }, select: { amount: true, conversations: true } } },
  });
  const byProduct = new Map();
  for (const ad of ads) {
    const p = ad.product; if (!p) continue;
    const conv = ad.spendDaily.reduce((s, r) => s + (Number(r.conversations) || 0), 0);
    const spend = ad.spendDaily.reduce((s, r) => s + Number(r.amount || 0), 0);
    const row = byProduct.get(p.id) || { productId: p.id, sku: p.sku, name: p.customerName || p.name, isSet: p.isSet, outOfStock: !!p.outOfStock, categoryId: p.category ? p.category.id : null, categoryName: p.category ? p.category.name : null, conversations: 0, spend: 0, ads: 0, thumbnailUrl: null, topConv: -1 };
    row.conversations += conv; row.spend += spend; row.ads += 1;
    if (conv > row.topConv && ad.thumbnailUrl) { row.thumbnailUrl = ad.thumbnailUrl; row.topConv = conv; }
    byProduct.set(p.id, row);
  }
  const data = [...byProduct.values()].map(({ topConv, ...r }) => ({ ...r, spend: Math.round(r.spend * 100) / 100 })).sort((a, b) => (b.conversations - a.conversations) || (b.spend - a.spend));
  res.json({ ok: true, data, meta: { days, since: since.toISOString() } });
}));

router.get('/ads/spend-summary', asyncHandler(async (req, res) => {
  const { from, to, search, linked, take = '10', skip = '0' } = req.query;
  const dateWhere = periodDateWhere(from, to);
  const where = {
    tenantId: req.tenant.id,
    ...(search ? { OR: [{ name: { contains: String(search), mode: 'insensitive' } }, { externalId: { contains: String(search) } }] } : {}),
    // 2026-09-12 (аудит аналітики): раніше "Без товару"/"З привʼязаним товаром" фільтрували
    // лише вже завантажену сторінку на фронті (AdSpendPage.jsx) — total/пагінація рахувались
    // без цього фільтра, тож частина оголошень губилась між сторінками. Фільтруємо тут,
    // ДО пагінації, щоб total і фактично показані рядки завжди збігались.
    ...(linked === 'true' ? { productId: { not: null } } : linked === 'false' ? { productId: null } : {}),
  };
  const [ads, total] = await Promise.all([
    db.ad.findMany({ where, include: { product: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }),
    db.ad.count({ where }),
  ]);
  const tenant = await ensureFreshUsdRate(req.tenant);
  const usdRate = Number(tenant.usdExchangeRate || 0);
  const expenseByProduct = await loadExpenseMap(req.tenant.id);
  const all = await computeAdStatsBatch(req.tenant.id, ads, dateWhere, expenseByProduct, usdRate);
  const statsByAd = new Map(all.map((s) => [s.adId, s]));

  const totals = all.reduce((acc, s) => {
    acc.spend += s.spend; acc.margin += s.margin; acc.orders += s.ordersCreated;
    if (s.spend > 0) acc.activeAds += 1;
    return acc;
  }, { spend: 0, margin: 0, orders: 0, activeAds: 0 });

  const adRows = ads.map((ad) => ({
    id: ad.id, name: ad.name, externalId: ad.externalId, thumbnailUrl: ad.thumbnailUrl, campaignName: ad.campaignName,
    effectiveStatus: ad.effectiveStatus, adCreatedAt: ad.adCreatedAt, postId: ad.postId || null, postUrl: ad.postUrl || null,
    productId: ad.productId, productName: ad.product?.name || null,
    ...statsByAd.get(ad.id),
  }));
  // Один рядок на пост (Edit 71b501a3, 2026-10-06): кожне «Просувати допис» — окреме оголошення Meta, і той самий пост
  // показувався 26 разів. Групуємо за postId (Meta effective_object_story_id) ДО пагінації; без postId — рядок сам по собі.
  // ?group=ad — по оголошеннях, як раніше.
  let rows = adRows;
  if (req.query.group !== 'ad') {
    const groups = new Map();
    for (const r of adRows) { const k = r.postId ? 'p:' + r.postId : 'a:' + r.id; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
    rows = [...groups.values()].map((g) => {
      if (g.length === 1) return { ...g[0], boosts: [] };
      const lead = [...g].sort((a, b) => (b.spend || 0) - (a.spend || 0))[0];
      const sum = (f) => g.reduce((s, r) => s + (Number(r[f]) || 0), 0);
      const spend = sum('spend'), margin = sum('margin'), contacts = sum('contacts'), ordersCreated = sum('ordersCreated'), ordersPickedUp = sum('ordersPickedUp');
      const profit = margin - spend;
      return {
        ...lead, spend, margin, profit, contacts, ordersCreated, ordersPickedUp, revenue: sum('revenue'), refusedCount: sum('refusedCount'),
        roi: spend > 0 ? margin / spend : null, romi: spend > 0 ? (profit / spend) * 100 : null,
        cpa: ordersCreated > 0 ? spend / ordersCreated : null, costPerContact: contacts > 0 ? spend / contacts : null,
        boosts: g.sort((a, b) => (b.spend || 0) - (a.spend || 0)).map((r) => ({ id: r.id, name: r.name, campaignName: r.campaignName, effectiveStatus: r.effectiveStatus, adCreatedAt: r.adCreatedAt, spend: r.spend, contacts: r.contacts, ordersCreated: r.ordersCreated })),
      };
    }).sort((a, b) => (b.spend || 0) - (a.spend || 0));
  }
  const paged = rows.slice(Number(skip), Number(skip) + Number(take));

  res.json({
    ok: true,
    data: paged,
    meta: { total: req.query.group === 'ad' ? total : rows.length, take: Number(take), skip: Number(skip) },
    totals: { activeAds: totals.activeAds, spend: totals.spend, orders: totals.orders, roi: totals.spend > 0 ? totals.margin / totals.spend : null },
  });
}));

// Детальна аналітика одного оголошення (drill-down з «Рекламні витрати»).
router.get('/ads/:id/detail', asyncHandler(async (req, res) => {
  const ad = await db.ad.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { product: { select: { id: true, name: true } } } });
  if (!ad) throw new NotFoundError('Ad', req.params.id);
  const { from, to } = req.query;
  const dateWhere = periodDateWhere(from, to);
  const tenant = await ensureFreshUsdRate(req.tenant);
  const usdRate = Number(tenant.usdExchangeRate || 0);
  const expenseByProduct = await loadExpenseMap(req.tenant.id);
  const stats = await computeAdStats(req.tenant.id, ad, dateWhere, expenseByProduct, usdRate);

  // Тренд по днях — та сама межа періоду, спред по днях (спенд з AdSpendDaily, маржа з
  // замовлень, створених того дня, по тій самій "фактичній" логіці — не відмова, без Return).
  const [spendRows, orders] = await Promise.all([
    db.adSpendDaily.findMany({ where: { adId: ad.id, ...(dateWhere ? { date: dateWhere } : {}) }, select: { date: true, amount: true, currency: true } }),
    db.order.findMany({
      where: { tenantId: req.tenant.id, firstTouchAdId: ad.id, ...(dateWhere ? { createdAt: dateWhere } : {}), ...REAL_SALE_ORDER_WHERE },
      select: { createdAt: true, items: { select: { productId: true, price: true, quantity: true } } },
    }),
  ]);
  const dayKey = kyivDayKey; // 2026-09-12: групування по днях за Києвом, не UTC (аудит аналітики)
  const days = new Map();
  const bucket = (k) => { if (!days.has(k)) days.set(k, { date: k, spend: 0, margin: 0 }); return days.get(k); };
  for (const row of spendRows) bucket(dayKey(row.date)).spend += rowToUAH(row.amount, row.currency, usdRate);
  for (const o of orders) {
    const b = bucket(dayKey(o.createdAt));
    for (const it of o.items) b.margin += marginPerOrderItem(it, expenseByProduct, false, o.createdAt);
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

  // 2026-09-13 (власник: "це я хочу вибирати на сторінці" — не хардкодити кабінет у funnelKey):
  // мультивибір кабінету(-ів) на сторінці «Оголошення» прокидається сюди й далі в contextOverride
  // тестової сесії — воронка читає context.metaAdAccountIds і синкає ЛИШЕ обрані кабінети.
  const { adAccountIds } = req.body || {};
  const contextOverride = (Array.isArray(adAccountIds) && adAccountIds.length) ? { metaAdAccountIds: adAccountIds } : {};

  const resp = await fetch(`${process.env.FLOWS_API_URL}/api/sessions/test/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Secret': process.env.FLOWS_API_SECRET },
    body: JSON.stringify({ botId: secret.value, contextOverride }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) throw new ValidationError('Flows не відповів успіхом: ' + (json?.error?.message || json?.error || resp.status));

  const snap = json.data?.contextSnapshot || {};
  // 2026-09-29: одразу після синхронізації — автоприв'язка неприв'язаних оголошень до товарів у Flows (фоново).
  let autoBind = null;
  try {
    const ab = await fetch(`${process.env.FLOWS_API_URL}/api/funnels/ads-autobind`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Secret': process.env.FLOWS_API_SECRET },
      body: JSON.stringify({ crmApiKey: req.tenant.apiKey }),
    });
    const abj = await ab.json().catch(() => null);
    autoBind = abj?.ok ? 'started' : 'error';
  } catch (e) { autoBind = 'error'; }
  res.json({ ok: true, data: { status: snap.metaSyncStatus || 'unknown', date: snap.metaSyncDate || null, adsCount: snap.metaSyncAdsCount ?? null, written: snap.metaSyncWritten ?? null, error: snap.metaSyncError || null, autoBind } });
}));

// §5: `POST /ad-spend-daily` — щоденні витрати від Flows-автоматизації (Zernio/Meta Ads).
// impressions/clicks — платформні метрики самого Facebook (для CPC/CTR/CPM), не наш AdClick.
router.post('/ad-spend-daily', asyncHandler(async (req, res) => {
  const { externalId, adId, name, date, amount, currency, impressions, clicks, conversations, campaignId, campaignName, adAccountId, thumbnailUrl } = req.body || {};
  if (!date || amount === undefined) throw new ValidationError('date і amount обовʼязкові');
  const ad = adId
    ? await db.ad.findFirst({ where: { id: adId, tenantId: req.tenant.id } })
    : await findOrCreateAdByExternalId(req.tenant.id, String(externalId || 'unknown'), name, { campaignId, campaignName, adAccountId, thumbnailUrl });
  if (!ad) throw new NotFoundError('Ad', adId);
  const row = await db.adSpendDaily.upsert({
    where: { adId_date: { adId: ad.id, date: new Date(date) } },
    update: { amount, currency: currency || 'UAH', ...(impressions !== undefined ? { impressions: Number(impressions) } : {}), ...(clicks !== undefined ? { clicks: Number(clicks) } : {}), ...(conversations !== undefined ? { conversations: Number(conversations) } : {}) },
    create: { adId: ad.id, date: new Date(date), amount, currency: currency || 'UAH', impressions: impressions !== undefined ? Number(impressions) : null, clicks: clicks !== undefined ? Number(clicks) : null, conversations: conversations !== undefined ? Number(conversations) : null },
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
