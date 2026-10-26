// §4.9 Ad / AdSpendDaily / AdClick + §9.13 Рекламні витрати.
// POST /ad-spend-daily і /ad-clicks — write-ендпойнти для окремої crontab-воронки FINEKO Flows,
// яка ходить у Zernio/Meta Ads API (§2, §5 ТЗ) — той самий Bearer tenant.apiKey.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { parseFrom, parseTo, kyivDayKey, dayRange } = require('../lib/dateRange');
const { loadExpenseMap, marginPerOrderItem, ORDER_PLACED_WHERE, REAL_SALE_ORDER_WHERE, LEAD_WHERE, placedAtOf } = require('../lib/margin');
const { findOrCreateAdByExternalId } = require('../lib/adAttribution');
const { linkAdVariantsFor, linkAllAdVariants, relinkVariantsByExternalId, propagateProductToVariants } = require('../lib/adVariants');
const { ensureFreshUsdRate, rowToUAH } = require('../lib/currency');
const { deliveryStatus } = require('../lib/deliveryStatus');

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
async function computeAdStatsBatch(tenantId, ads, dateWhere, expenseByProduct, usdRate, refusalPct = 23) {
  if (!ads.length) return [];
  const ids = ads.map((a) => a.id);
  const one = ids.length === 1;
  const [spendRows, clickRows, orders] = await Promise.all([
    // Meta пише суму у $ — конвертуємо в грн, щоб margin/spend (ROI) не змішували валюти
    // (2026-09-07, фідбек власника).
    db.adSpendDaily.groupBy({ by: ['adId', 'currency'], where: { ...(one ? { adId: ids[0] } : { ad: { tenantId } }), ...(dateWhere ? { date: dayRange(dateWhere) } : {}) }, _sum: { amount: true } }),
    // Контакти = розмови, що почались із цієї реклами (картки воронки, lib/margin LEAD_WHERE); раніше — порожня AdClick.
    db.order.groupBy({ by: ['firstTouchAdId'], where: { tenantId, firstTouchAdId: one ? ids[0] : { not: null }, ...LEAD_WHERE, ...(dateWhere ? { createdAt: dateWhere } : {}) }, _count: { _all: true } })
      .then((rows) => rows.map((r) => ({ adId: r.firstTouchAdId, _count: r._count }))),
    // Замовлення = оформлені (є покупець), не картки розмов, яким бот лише показав товар.
    db.order.findMany({
      where: { tenantId, firstTouchAdId: one ? ids[0] : { not: null }, ...ORDER_PLACED_WHERE, ...(dateWhere ? { placedAt: dateWhere } : {}) },
      select: {
        id: true, createdAt: true, placedAt: true, isRefused: true, ttn: true, ttnStatus: true, stage: { select: { name: true } }, firstTouchAdId: true, funnelSessionId: true, contactIg: true, contactName: true,
        buyer: { select: { fullName: true, igUsername: true, phone: true } },
        returns: { select: { id: true } },
        items: { select: { productId: true, name: true, price: true, quantity: true, product: { select: { name: true } } } },
      },
      orderBy: { placedAt: 'desc' },
    }),
  ]);
  const spendBy = new Map();
  for (const r of spendRows) spendBy.set(r.adId, (spendBy.get(r.adId) || 0) + rowToUAH(r._sum.amount, r.currency, usdRate));
  const clicksBy = new Map(clickRows.map((r) => [r.adId, r._count._all]));
  const ordersBy = new Map();
  for (const o of orders) { const l = ordersBy.get(o.firstTouchAdId) || []; l.push(o); ordersBy.set(o.firstTouchAdId, l); }
  return ads.map((ad) => statsFromData(ad, spendBy.get(ad.id) || 0, clicksBy.get(ad.id) || 0, ordersBy.get(ad.id) || [], expenseByProduct, refusalPct));
}

async function computeAdStats(tenantId, ad, dateWhere, expenseByProduct, usdRate, refusalPct) {
  return (await computeAdStatsBatch(tenantId, [ad], dateWhere, expenseByProduct, usdRate, refusalPct))[0];
}

// Очікувані відмови й повернення, % (налаштування магазину; за замовчуванням 23 = 20 відмов на пошті + 3 повернення — Олексій, Edits 537c402a).
const refusalPctOf = (tenant) => { const v = Number(tenant && tenant.expectedRefusalPct); return Number.isFinite(v) && v >= 0 && v < 100 && tenant.expectedRefusalPct !== null ? v : 23; };

function statsFromData(ad, spend, contacts, orders, expenseByProduct, refusalPct = 23) {
  const ordersCreated = orders.length;
  const pickedUp = orders.filter((o) => !o.isRefused);
  const ordersPickedUp = pickedUp.length;
  const refusedCount = ordersCreated - ordersPickedUp;
  const revenueOrders = pickedUp.filter((o) => o.returns.length === 0); // "фактична" виручка — без відмов і без повернень

  let revenue = 0, margin = 0;
  // «З відмовами» (Edits 537c402a): посилки, які ще не забрали (очікує / в дорозі / на пошті), можуть повернутись — їхню маржу
  // зменшуємо на очікуваний % відмов; уже забрані — як є, відмови й повернення вже не в маржі (інакше відмови врахувались би двічі).
  let marginExpected = 0;
  const productsMap = new Map(); // productId||name -> {name, qty}
  const orderRows = [];
  for (const o of orders) {
    let orderRevenue = 0, orderMargin = 0;
    for (const it of o.items) {
      orderRevenue += Number(it.price) * it.quantity;
      orderMargin += marginPerOrderItem(it, expenseByProduct, o.isRefused, placedAtOf(o));
    }
    const dStatus = deliveryStatus(o);
    if (revenueOrders.includes(o)) {
      revenue += orderRevenue;
      margin += orderMargin;
      marginExpected += dStatus === 'picked_up' ? orderMargin : orderMargin * (1 - refusalPct / 100);
      for (const it of o.items) {
        const key = it.productId || it.name;
        const row = productsMap.get(key) || { name: it.product?.name || it.name, qty: 0 };
        row.qty += it.quantity;
        productsMap.set(key, row);
      }
    }
    orderRows.push({
      id: o.id,
      funnelSessionId: o.funnelSessionId || null,
      // 2026-10-14 (власник): у списку — імʼя людини й нікнейм Instagram замість id.
      buyerName: (o.buyer && o.buyer.fullName) || o.contactName || null,
      igUsername: String((o.buyer && o.buyer.igUsername) || o.contactIg || '').replace(/^@/, '') || null,
      // Пошук розмови у Flows для замовлень, оформлених менеджером (без funnelSessionId): нікнейм, інакше останні 9 цифр телефону.
      flowsSearch: String((o.buyer && o.buyer.igUsername) || o.contactIg || '').replace(/^@/, '') || String((o.buyer && o.buyer.phone) || '').replace(/\D/g, '').slice(-9) || null,
      createdAt: placedAtOf(o),
      itemsLabel: o.items.map((it) => it.product?.name || it.name).join(', ') || '—',
      status: dStatus, // Edits 47935e18: очікує / в дорозі / на пошті / відмова / повернення / забрано (lib/deliveryStatus)
      revenue: orderRevenue,
      margin: orderMargin,
    });
  }

  const profit = margin - spend;
  const profitExpected = marginExpected - spend;
  return {
    adId: ad.id,
    marginExpected,
    profitExpected,
    roiExpected: spend > 0 ? marginExpected / spend : null,
    romiExpected: spend > 0 ? (profitExpected / spend) * 100 : null,
    refusalPct,
    refusedRate: ordersCreated > 0 ? (refusedCount / ordersCreated) * 100 : null,
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
  // running=N — оголошення, що реально крутились останні N днів (є витрати), без варіантів Advantage+: вибір реклами в картці
  // замовлення (Edits f609591e, 26.10: брали 30 найновіших за датою запуску — старіші, що досі крутяться, не влазили).
  const runningDays = Math.min(60, Math.max(0, Number(req.query.running) || 0));
  let runningIds = null;
  if (runningDays) {
    const since = new Date(Date.now() - runningDays * 86400000); since.setUTCHours(0, 0, 0, 0);
    runningIds = (await db.adSpendDaily.groupBy({ by: ['adId'], where: { ad: { tenantId: req.tenant.id, variantOfAdId: null, ...(productId ? { productId: String(productId) } : {}) }, date: { gte: since }, amount: { gt: 0 } } })).map((r) => r.adId);
  }
  const statusFilter = (!externalId && status !== 'all' && !runningIds) ? { OR: [{ effectiveStatus: 'ACTIVE' }, { effectiveStatus: null }] } : {};
  const where = {
    tenantId: req.tenant.id,
    ...(productId ? { productId: String(productId) } : {}),
    ...(externalId ? { externalId: String(externalId) } : {}),
    ...(acctIds.length ? { adAccountId: { in: acctIds } } : {}),
    // search — вибір реклами для замовлення вручну (картка замовлення, 2026-10-06): назва, кампанія або Meta-id.
    ...(search ? { AND: [{ OR: [{ name: { contains: String(search), mode: 'insensitive' } }, { campaignName: { contains: String(search), mode: 'insensitive' } }, { externalId: { contains: String(search) } }] }] } : {}),
    ...statusFilter,
    ...(runningIds ? { id: { in: runningIds } } : {}),
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
  // Варіант Advantage+ без власного товару — товар його «батька» (18.10, nadinar_ad: варіант привʼязали до батька ДО того, як
  // батькові поставили товар, і воронка показала список комплектів замість set1120). Лише у відповіді, запис не чіпаємо.
  const __noProd = ads.filter((a) => !a.productId && a.variantOfAdId);
  if (__noProd.length) {
    const parents = await db.ad.findMany({ where: { id: { in: [...new Set(__noProd.map((a) => a.variantOfAdId))] } }, select: { id: true, productId: true, product: { select: { id: true, name: true } } } });
    const byId = new Map(parents.map((p) => [p.id, p]));
    for (const a of __noProd) { const p = byId.get(a.variantOfAdId); if (p && p.productId) { a.productId = p.productId; a.product = p.product; a.productViaParent = true; } }
  }
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
    await linkAdVariantsFor(ad).catch(() => null);
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
  await linkAdVariantsFor(ad).catch(() => null);
  res.status(201).json({ ok: true, data: ad });
}));

// Варіанти Advantage+ («_Group_1») → справжні оголошення, повний прохід (бекфіл; далі звʼязує POST /ads і атрибуція самі).
// relinkExternalIds — перевірити вже привʼязані варіанти: якщо їхнє оголошення не крутиться, а однойменне живе є — перепривʼязати (2026-10-15).
router.post('/ads/link-variants', asyncHandler(async (req, res) => {
  const dryRun = !!(req.body && req.body.dryRun);
  const relink = req.body && Array.isArray(req.body.relinkExternalIds) ? req.body.relinkExternalIds.slice(0, 50) : null;
  if (relink) return void res.json({ ok: true, data: await relinkVariantsByExternalId(req.tenant.id, relink, { dryRun }) });
  res.json({ ok: true, data: await linkAllAdVariants(req.tenant.id, { dryRun }) });
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
  // Товар оголошення змінили — його варіанти Advantage+ без власного (або з автоматично успадкованим) товару отримують той самий (18.10).
  if (productId !== undefined && (productId || null) !== existing.productId) {
    await propagateProductToVariants(req.tenant.id, existing.id, productId).catch(() => null);
  }
  // Назву оновили (порожній запис «Реклама <id>» отримав назву з Meta) — варіант Advantage+ шукає «батька» з тією ж назвою (16.10).
  if (name !== undefined && name !== existing.name) await linkAdVariantsFor(ad).catch(() => null);
  res.json({ ok: true, data: ad });
}));

// §9.13 таблиця дата×кабінет/оголошення×товар×сума — з agregацією по AdSpendDaily.
router.get('/ad-spend', asyncHandler(async (req, res) => {
  const { from, to, productId, take = '200', skip = '0' } = req.query;
  const where = {
    ad: { tenantId: req.tenant.id, ...(productId ? { productId: String(productId) } : {}) },
    ...(from || to ? { date: dayRange(from, to) } : {}),
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
  // Edits 55e6794d (Олексій): сортування за колонкою (від більшого до меншого й навпаки) і без оголошень, де за період нічого нема
  // («117 сторінок» — це 1167 оголошень за весь час, більшість без витрат). showEmpty=1 — показати всі.
  const SORTS = { spend: 'spend', contacts: 'contacts', orders: 'ordersCreated', cpa: 'cpa', roi: 'roi', profit: 'profit' };
  const sortKey = SORTS[String(req.query.sort || 'spend')] || 'spend';
  const dir = String(req.query.dir || 'desc') === 'asc' ? 1 : -1;
  const showEmpty = req.query.showEmpty === '1' || req.query.showEmpty === 'true';
  const dateWhere = periodDateWhere(from, to);
  const where = {
    tenantId: req.tenant.id,
    // Варіанти Advantage+ («_Group_1») — не окремі оголошення: їхні розмови й продажі зараховано справжньому (lib/adVariants.js).
    variantOfAdId: null,
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
  const all = await computeAdStatsBatch(req.tenant.id, ads, dateWhere, expenseByProduct, usdRate, refusalPctOf(tenant));
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
        boosts: g.sort((a, b) => (b.spend || 0) - (a.spend || 0)).map((r) => ({ id: r.id, externalId: r.externalId, name: r.name, campaignName: r.campaignName, effectiveStatus: r.effectiveStatus, adCreatedAt: r.adCreatedAt, spend: r.spend, contacts: r.contacts, ordersCreated: r.ordersCreated })),
      };
    });
  }
  // Окупність по товарах (план Б11): ті самі цифри, згруповані за товаром оголошення; без товару — один рядок «Без товару».
  if (req.query.group === 'product') {
    const byProd = new Map();
    for (const r of adRows) {
      const k = r.productId || 'none';
      const g = byProd.get(k) || { id: 'product:' + k, productId: r.productId || null, name: r.productName || 'Без товару', productName: null, thumbnailUrl: null, spend: 0, margin: 0, contacts: 0, ordersCreated: 0, ordersPickedUp: 0, revenue: 0, refusedCount: 0, adsCount: 0, activeAds: 0, _topSpend: -1, boosts: [] };
      g.spend += r.spend || 0; g.margin += r.margin || 0; g.contacts += r.contacts || 0; g.ordersCreated += r.ordersCreated || 0;
      g.ordersPickedUp += r.ordersPickedUp || 0; g.revenue += r.revenue || 0; g.refusedCount += r.refusedCount || 0; g.adsCount += 1;
      if ((r.spend || 0) > 0) g.activeAds += 1;
      if ((r.spend || 0) > g._topSpend && r.thumbnailUrl) { g.thumbnailUrl = r.thumbnailUrl; g._topSpend = r.spend || 0; }
      byProd.set(k, g);
    }
    rows = [...byProd.values()].map(({ _topSpend, ...g }) => {
      const profit = g.margin - g.spend;
      return { ...g, profit, roi: g.spend > 0 ? g.margin / g.spend : null, romi: g.spend > 0 ? (profit / g.spend) * 100 : null, cpa: g.ordersCreated > 0 ? g.spend / g.ordersCreated : null };
    });
  }
  if (!showEmpty) rows = rows.filter((r) => (r.spend || 0) > 0 || (r.ordersCreated || 0) > 0 || (r.contacts || 0) > 0);
  // null (ділення на нуль) — завжди в кінці, незалежно від напрямку.
  rows.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x - y) * dir; });
  const paged = rows.slice(Number(skip), Number(skip) + Number(take));

  res.json({
    ok: true,
    data: paged,
    meta: { total: rows.length, take: Number(take), skip: Number(skip), usdRate },
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
  const stats = await computeAdStats(req.tenant.id, ad, dateWhere, expenseByProduct, usdRate, refusalPctOf(tenant));

  // Тренд по днях — та сама межа періоду, спред по днях (спенд з AdSpendDaily, маржа з
  // замовлень, створених того дня, по тій самій "фактичній" логіці — не відмова, без Return).
  const [spendRows, orders] = await Promise.all([
    db.adSpendDaily.findMany({ where: { adId: ad.id, ...(dateWhere ? { date: dayRange(dateWhere) } : {}) }, select: { date: true, amount: true, currency: true } }),
    db.order.findMany({
      where: { tenantId: req.tenant.id, firstTouchAdId: ad.id, ...(dateWhere ? { placedAt: dateWhere } : {}), ...REAL_SALE_ORDER_WHERE },
      select: { createdAt: true, placedAt: true, items: { select: { productId: true, price: true, quantity: true } } },
    }),
  ]);
  const dayKey = kyivDayKey; // 2026-09-12: групування по днях за Києвом, не UTC (аудит аналітики)
  const days = new Map();
  const bucket = (k) => { if (!days.has(k)) days.set(k, { date: k, spend: 0, margin: 0 }); return days.get(k); };
  for (const row of spendRows) bucket(dayKey(row.date)).spend += rowToUAH(row.amount, row.currency, usdRate);
  for (const o of orders) {
    const b = bucket(dayKey(placedAtOf(o)));
    for (const it of o.items) b.margin += marginPerOrderItem(it, expenseByProduct, false, placedAtOf(o));
  }
  const trend = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, profit: d.margin - d.spend, roi: d.spend > 0 ? d.margin / d.spend : null }));

  res.json({
    ok: true,
    data: {
      ad: { id: ad.id, name: ad.name, externalId: ad.externalId, thumbnailUrl: ad.thumbnailUrl, campaignName: ad.campaignName, productId: ad.productId, productName: ad.product?.name || null, postUrl: ad.postUrl || null, effectiveStatus: ad.effectiveStatus || null },
      ...stats,
      trend,
      usdRate,
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
