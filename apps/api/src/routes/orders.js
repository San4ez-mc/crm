// §4.8 Order + OrderItem — основний робочий екран менеджера (§9.7/9.8) + операції для воронки (§5).
const express = require('express');
const { db } = require('@crm/db');
const { touchFields, touchFromCard } = require('../lib/adAttribution');
const { canonicalAdId } = require('../lib/adVariants');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { parseFrom, parseTo } = require('../lib/dateRange');
const { igOrNull, igSearchTerm, normalizeInstagram } = require('../lib/instagram');
const { itemsTotal, paymentFields, resolveItemSuppliers, parseTtnList, shippedStagePatch, applyBuyerEdit, deleteOrder, restoreOrder, acceptancePatch } = require('../lib/orderOps');
const { syncTtnStatuses } = require('../lib/novaPoshta');
const { buildXlsx } = require('../lib/xlsx');
const logger = require('@crm/logger');

const router = express.Router();

const ORDER_INCLUDE = {
  buyer: true,
  stage: { include: { pipeline: { select: { id: true, name: true } } } },
  // thumbnailUrl/images — щоб картка замовлення могла показати фото замовлених товарів
  // (2026-09-08, фідбек власника); offer.images — фото КОНКРЕТНОГО кольору/розміру, якщо є,
  // пріоритетніше за загальне фото товару.
  // supplier — постачальник позиції (2026-10-18), product.supplierId — щоб форма могла показати постачальника з каталогу.
  items: { include: { product: { select: { id: true, name: true, sku: true, thumbnailUrl: true, images: true, supplierId: true } }, offer: { select: { id: true, sku: true, images: true } }, supplier: { select: { id: true, name: true } } } },
  returns: true,
  firstTouchAd: { select: { id: true, name: true, externalId: true, campaignName: true, thumbnailUrl: true, postUrl: true, effectiveStatus: true } },
  lastTouchAd: { select: { id: true, name: true, externalId: true, campaignName: true, thumbnailUrl: true, postUrl: true, effectiveStatus: true } },
};

// Оплати замовлення (2026-10-14, власник: «у картці замовлення має бути видно оплату»). Платежі пишуть бот і фонова
// перезвірка Flows через POST /payments. Успішна = status 'success' або не вказано (POST ставить 'success' за замовчуванням).
const PAYMENTS_INCLUDE = { select: { id: true, amount: true, method: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } };
const isPaidStatus = (status) => !status || status === 'success';
const PAID_WHERE = { OR: [{ status: 'success' }, { status: null }] };

/** Сума успішних оплат на кожне замовлення — один groupBy на всю сторінку списку (не запит на рядок, CLAUDE.md §9.5). */
async function paidSumsByOrder(tenantId, orderIds) {
  if (!orderIds.length) return new Map();
  const rows = await db.payment.groupBy({ by: ['orderId'], where: { tenantId, orderId: { in: orderIds }, ...PAID_WHERE }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.orderId, Number(r._sum.amount || 0)]));
}

function withPaidSum(order) {
  const payments = Array.isArray(order.payments) ? order.payments : [];
  return { ...order, paidSum: payments.filter((p) => isPaidStatus(p.status)).reduce((s, p) => s + Number(p.amount || 0), 0) };
}

async function defaultStageId(tenantId) {
  const pipeline = await db.pipeline.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { order: 'asc' }, take: 1 } } });
  return pipeline?.stages?.[0]?.id || null;
}

// ── Список (kanban/таблиця) ──────────────────────────────────────────────
// WHERE списку замовлень за фільтрами сторінки (пошук, реклама, дата, стадія) — один на список і на вивантаження в Excel (2026-11-04).
function buildOrdersWhere(tenantId, query) {
  const { stageId, from, to, ftFrom, ftTo, productId, adId, noAd, q, deleted } = query;
  // q і adId — обидва OR-блоки, тому комбінуємо через AND (інакше другий спред перезаписав би
  // перший ключ "OR" в об'єкті where — знайдено під час додавання фільтра по рекламі 2026-09-04).
  const andClauses = [];
  if (q) {
    // 2026-10-18 (Олексій: «не шукає клієнта по посиланню»): посилання на Instagram або @нік → шукаємо за нікнеймом
    // (покупець і картка розмови); інакше — як раніше ТТН/телефон/імʼя, плюс нікнейм і імʼя з Instagram на картці.
    const qs = String(q).trim();
    const ig = igSearchTerm(qs);
    const digits = qs.replace(/\D/g, '');
    andClauses.push({ OR: ig ? [
      { contactIg: { equals: ig, mode: 'insensitive' } },
      { buyer: { is: { igUsername: { equals: ig, mode: 'insensitive' } } } },
    ] : [
      { ttn: { has: qs } },
      { buyer: { is: { OR: [
        { phone: { contains: qs } },
        ...(digits.length >= 3 && digits !== qs ? [{ phone: { contains: digits } }] : []),
        { fullName: { contains: qs, mode: 'insensitive' } },
        { igUsername: { contains: qs.replace(/^@/, ''), mode: 'insensitive' } },
      ] } } },
      { contactIg: { contains: qs.replace(/^@/, ''), mode: 'insensitive' } },
      { contactName: { contains: qs, mode: 'insensitive' } },
    ] });
  }
  if (adId) andClauses.push({ OR: [{ firstTouchAdId: String(adId) }, { lastTouchAdId: String(adId) }] });
  // 2026-09-12 (КРИТИЧНО, живий баг знайдено одразу після деплою): firstTouchAt історично НІКОЛИ не
  // заповнювався воронкою (усі існуючі замовлення мають firstTouchAt=null) — фільтр по НЬОМУ напряму
  // ховав би АБСОЛЮТНО ВСІ замовлення, щойно власник відкрив би дошку (дефолт = останні 7 днів).
  // Fallback: якщо firstTouchAt відомий — фільтруємо по ньому; якщо ні (null) — по createdAt (це й
  // так було справжньою датою першого контакту для старих замовлень, де окреме поле не велось).
  // Воронка тепер заповнює firstTouchAt/firstTouchAdId на НОВИХ замовленнях (apps/api n_crm_order).
  // 2026-10-26 (Edits c4fc2dcd): фільтр дошки — дата ОФОРМЛЕННЯ замовлення, для карток розмов — дата розмови. Раніше — дата
  // першого дотику реклами, яку ручний вибір реклами ставив на день правки (замовлення 20.10 «переїжджало» на 23.10).
  if (ftFrom || ftTo) {
    const ftRange = { ...(ftFrom ? { gte: parseFrom(ftFrom) } : {}), ...(ftTo ? { lte: parseTo(ftTo) } : {}) };
    andClauses.push({ OR: [
      { placedAt: ftRange },
      { AND: [{ placedAt: null }, { createdAt: ftRange }] },
    ] });
  }
  // «Без реклами» (Edits 15b533ae): оформлені замовлення, де не відомо, з якого оголошення написав клієнт — щоб вказати вручну.
  if (noAd === '1' || noAd === 'true') andClauses.push({ buyerId: { not: null }, firstTouchAdId: null });
  return {
    tenantId,
    // Видалені (м'яко) замовлення у списку не показуємо; `?deleted=1` — окремий перегляд, щоб відновити помилково видалене.
    deletedAt: deleted === '1' || deleted === 'true' ? { not: null } : null,
    ...(stageId ? { stageId: String(stageId) } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}),
    ...(productId ? { items: { some: { productId: String(productId) } } } : {}),
    ...(andClauses.length ? { AND: andClauses } : {}),
  };
}

router.get('/orders', asyncHandler(async (req, res) => {
  const { take = '100', skip = '0' } = req.query;
  const where = buildOrdersWhere(req.tenant.id, req.query);
  const [items, total] = await Promise.all([
    db.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: Number(take), skip: Number(skip) }),
    db.order.count({ where }),
  ]);
  const paid = await paidSumsByOrder(req.tenant.id, items.map((o) => o.id));
  res.json({ ok: true, data: items.map((o) => ({ ...o, paidSum: paid.get(o.id) || 0 })), meta: { total, take: Number(take), skip: Number(skip) } });
}));

// Дата оформлення з тіла запиту («Змінити дату», імпорт) — інакше null (тоді «зараз»).
function placedAtFrom(v) { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
// «Хто оформив» (Edits 15b533ae): явно з тіла (імпорт EasyDrop) → менеджер, що вхід у CRM → «Бот» для замовлення з розмови.
function placedByFrom(b, req, fromFunnel) { return (b.placedBy && String(b.placedBy).trim().slice(0, 80)) || (req.user && req.user.name) || (fromFunnel ? 'Бот' : null); }

// ── Створення (переважно з воронки) ──────────────────────────────────────
router.post('/orders', asyncHandler(async (req, res) => {
  const b = req.body || {};
  // Варіант Advantage+ («_Group_1») → справжнє оголошення (lib/adVariants.js), як і в атрибуції за Meta-id.
  if (b.firstTouchAdId) b.firstTouchAdId = await canonicalAdId(req.tenant.id, b.firstTouchAdId);
  if (b.lastTouchAdId) b.lastTouchAdId = await canonicalAdId(req.tenant.id, b.lastTouchAdId);
  if (!Array.isArray(b.items) || !b.items.length) throw new ValidationError('items[] обовʼязкові (хоча б одна позиція)');

  // Instagram — лише нікнейм (посилання/@нік нормалізуються, lib/instagram.js), 2026-10-18.
  const buyerIg = b.buyer ? igOrNull(b.buyer.igUsername) : null;
  let buyerId = b.buyerId || null;
  if (!buyerId && b.buyer?.phone) {
    const normalized = String(b.buyer.phone).replace(/[^\d+]/g, '');
    const buyer = await db.buyer.upsert({
      where: { tenantId_phone: { tenantId: req.tenant.id, phone: normalized } },
      update: {},
      create: { tenantId: req.tenant.id, phone: normalized, fullName: b.buyer.fullName || null, igUsername: buyerIg },
    });
    // Відомий покупець без імені/Instagram — доповнюємо з цього замовлення (не перезаписуємо вже збережене).
    const fill = { ...(!buyer.fullName && b.buyer.fullName ? { fullName: String(b.buyer.fullName) } : {}), ...(!buyer.igUsername && buyerIg ? { igUsername: buyerIg } : {}) };
    if (Object.keys(fill).length) await db.buyer.update({ where: { id: buyer.id }, data: fill }).catch(() => {});
    buyerId = buyer.id;
  }
  // Позиції: постачальник кожної (явно або з каталогу) і сума — для полів оплати.
  const itemSuppliers = await resolveItemSuppliers(req.tenant.id, b.items);
  const payFields = paymentFields(b, itemsTotal(b.items), null, req.tenant.prepaymentAmount);
  const itemsCreate = b.items.map((it, i) => ({
    productId: it.productId || null,
    offerId: it.offerId || null,
    name: it.name,
    price: it.price,
    quantity: Number(it.quantity) || 1,
    properties: it.properties || null,
    isUpsell: !!it.isUpsell,
    supplierId: itemSuppliers[i],
  }));

  // Реквізити доставки з цього замовлення запам'ятовуємо на покупцеві (Buyer.knownShipping) —
  // щоб наступного разу воронка могла запропонувати вже відомі дані замість повторного
  // запитування (2026-09-04, за проханням власника). Best-effort: помилка тут не має зривати
  // створення самого замовлення.
  if (buyerId && b.shipping && (b.shipping.city || b.shipping.warehouse)) {
    const existingBuyer = await db.buyer.findUnique({ where: { id: buyerId }, select: { knownShipping: true, fullName: true, phone: true } });
    await db.buyer.update({
      where: { id: buyerId },
      data: {
        knownShipping: {
          ...(existingBuyer?.knownShipping || {}),
          fullName: b.shipping.fullName || existingBuyer?.fullName || undefined,
          phone: b.shipping.phone || existingBuyer?.phone || undefined,
          ...(b.shipping.city ? { city: b.shipping.city } : {}),
          ...(b.shipping.warehouse ? { warehouse: b.shipping.warehouse } : {}),
        },
      },
    }).catch(() => {});
  }

  // stageName — стадія за назвою (зручно для зовнішніх скриптів, напр. PHP лендінгу: «Замовлення прийняте»); не знайшли → перша стадія.
  let stageId = b.stageId || null;
  if (!stageId && b.stageName) {
    const st = await db.stage.findFirst({ where: { name: String(b.stageName), pipeline: { tenantId: req.tenant.id } }, select: { id: true }, orderBy: { order: 'asc' } });
    stageId = st ? st.id : null;
  }
  stageId = stageId || await defaultStageId(req.tenant.id);

  // 2026-09-09: картка цієї розмови вже є на дошці (створена з /funnel-events) → доповнюємо її, а не дублюємо.
  if (b.funnelSessionId) {
    const card = await db.order.findFirst({ where: { tenantId: req.tenant.id, funnelSessionId: String(b.funnelSessionId) } });
    if (card) {
      const cardTouch = await touchFields(req.tenant.id, { firstTouch: b.firstTouch, lastTouch: b.lastTouch }, card);
      await db.orderItem.deleteMany({ where: { orderId: card.id } });
      const updated = await db.order.update({
        where: { id: card.id },
        data: {
          buyerId, stageId,
          ...payFields,
          // Картка розмови стала замовленням саме зараз: це й дата оформлення (createdAt картки — початок розмови).
          placedAt: placedAtFrom(b.placedAt) || card.placedAt || new Date(),
          placedBy: card.placedBy || placedByFrom(b, req, true),
          sourceName: b.sourceName || card.sourceName || null,
          managerComment: b.managerComment || null,
          shipping: b.shipping || null,
          ttn: Array.isArray(b.ttn) ? b.ttn : card.ttn,
          ...(b.firstTouchAdId ? { firstTouchAdId: b.firstTouchAdId, firstTouchAt: b.firstTouchAt ? new Date(b.firstTouchAt) : new Date() } : {}),
          ...(b.lastTouchAdId ? { lastTouchAdId: b.lastTouchAdId, lastTouchAt: b.lastTouchAt ? new Date(b.lastTouchAt) : new Date() } : {}),
          ...cardTouch,
          lastClientAt: new Date(),
          deletedAt: null, deletedBy: null, // клієнт оформив замовлення після того, як картку видалили, — це нове реальне замовлення
          items: { create: itemsCreate },
        },
        include: ORDER_INCLUDE,
      });
      return void res.status(201).json({ ok: true, data: updated, reusedFunnelCard: true });
    }
  }

  let newTouch = await touchFields(req.tenant.id, { firstTouch: b.firstTouch, lastTouch: b.lastTouch }, null);
  // Замовлення не з розмови (вручну, EasyDrop) без реклами — реклама з картки розмови цього клієнта (Edits 44c07e5b/ae75528c, 26.10).
  if (!b.funnelSessionId && !b.firstTouchAdId && !newTouch.firstTouchAdId) newTouch = { ...newTouch, ...(await touchFromCard(req.tenant.id, igOrNull(b.contactIg) || buyerIg)) };
  const order = await db.order.create({
    data: {
      tenantId: req.tenant.id,
      buyerId,
      stageId,
      sourceName: b.sourceName || null,
      managerComment: b.managerComment || null,
      shipping: b.shipping || null,
      ttn: b.ttn !== undefined ? parseTtnList(b.ttn) : [],
      ...(buyerId ? { placedAt: placedAtFrom(b.placedAt) || new Date(), placedBy: placedByFrom(b, req, !!b.funnelSessionId) } : {}),
      funnelSessionId: b.funnelSessionId ? String(b.funnelSessionId) : null,
      lastClientAt: b.funnelSessionId ? new Date() : null,
      firstTouchAdId: b.firstTouchAdId || null,
      firstTouchAt: b.firstTouchAt ? new Date(b.firstTouchAt) : (b.firstTouchAdId ? new Date() : null),
      lastTouchAdId: b.lastTouchAdId || null,
      lastTouchAt: b.lastTouchAt ? new Date(b.lastTouchAt) : (b.lastTouchAdId ? new Date() : null),
      ...newTouch, // дотики за Meta-id (Flows) — після явних firstTouchAdId/lastTouchAdId, щоб null не перекрив знайдене
      ...payFields,
      // Нікнейм на самій картці — щоб бот (lookup-client) і пошук знаходили й ручні замовлення.
      ...(b.contactIg || buyerIg ? { contactIg: igOrNull(b.contactIg) || buyerIg } : {}),
      ...(b.contactName ? { contactName: String(b.contactName) } : {}),
      items: { create: itemsCreate },
    },
    include: ORDER_INCLUDE,
  });
  res.status(201).json({ ok: true, data: order });
}));

// Замовлення клієнта для бота (2026-10-14, власник: «якщо замовлення є в СРМ — бот сам дивиться статус, нема — кличе менеджера»).
// Замовлення оформлюють і бот, і менеджери вручну — шукаємо за розмовою воронки, Instagram-нікнеймом (картка й покупець) і телефоном.
// Лише оформлені (є покупець), найсвіжіше. Нічого не знайдено — data:null.
router.get('/orders/lookup-client', asyncHandler(async (req, res) => {
  const { funnelSessionId, ig, phone } = req.query;
  const igN = normalizeInstagram(ig) || String(ig || '').replace(/^@/, '').trim();
  const ph = String(phone || '').replace(/\D/g, '').slice(-9);
  const or = [];
  if (funnelSessionId) or.push({ funnelSessionId: String(funnelSessionId) });
  if (igN) { or.push({ contactIg: { equals: igN, mode: 'insensitive' } }); or.push({ buyer: { is: { igUsername: { equals: igN, mode: 'insensitive' } } } }); }
  if (ph.length === 9) or.push({ buyer: { is: { phone: { contains: ph } } } });
  if (!or.length) return void res.json({ ok: true, data: null });
  const find = () => db.order.findFirst({
    where: { tenantId: req.tenant.id, buyerId: { not: null }, deletedAt: null, OR: or },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, ttn: true, ttnStatus: true, ttnStatusAt: true, ttnEta: true, isRefused: true, funnelSessionId: true, stage: { select: { name: true } }, items: { select: { name: true, quantity: true, product: { select: { name: true, customerName: true } } } }, returns: { select: { id: true, type: true, status: true } } },
  });
  let o = await find();
  // Клієнт питає про замовлення — статус НП свіжий на момент відповіді (2026-10-20): старший за 10 хв → CRM питає НП сама.
  // Стадію тут не рухаємо (це робить щогодинний /orders/ttn-sync зі сповіщенням менеджерам); НП не відповіла — віддаємо, що є.
  if (o && o.ttn.length && (!o.ttnStatusAt || Date.now() - new Date(o.ttnStatusAt).getTime() > 10 * 60 * 1000)) {
    try { const r = await syncTtnStatuses(req.tenant.id, { orderIds: [o.id], moveStages: false, timeoutMs: 3000 }); if (r.updated) o = await find(); }
    catch (e) { logger.warn('lookup-client: НП не відповіла', { orderId: o.id, error: e.message }); }
  }
  res.json({ ok: true, data: o || null });
}));

// Статуси Нової пошти всіх оформлених замовлень з ТТН (2026-10-20): CRM питає НП сама, пише статус, дату доставки й стадію.
// Викликає щогодинний крон Flows (np-ttn-status-goverla) — він лише шле менеджерам підсумок із `moved`.
router.post('/orders/ttn-sync', asyncHandler(async (req, res) => {
  const r = await syncTtnStatuses(req.tenant.id, { maxAgeMs: Number((req.body || {}).maxAgeMs) || 0 });
  res.json({ ok: true, data: r });
}));
// Кнопка «Оновити зараз» у картці замовлення.
router.post('/orders/:id/ttn-refresh', asyncHandler(async (req, res) => {
  const existing = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, select: { id: true, ttn: true } });
  if (!existing) throw new NotFoundError('Order', req.params.id);
  if (!existing.ttn.length) throw new ValidationError('У замовлення немає ТТН');
  res.json({ ok: true, data: await syncTtnStatuses(req.tenant.id, { orderIds: [existing.id] }) });
}));

// Зведення над списком (2026-11-04, Олексій): скільки замовлень і на яку суму за обраними фільтрами, з розбивкою по стадіях. Рахується по ВСІХ
// знайдених, а не по перших 100 зі списку. «Оформлені» = є покупець (картки розмов без покупця — окремо, як у звітах: lib/margin ORDER_PLACED_WHERE).
router.get('/orders/summary', asyncHandler(async (req, res) => {
  const where = buildOrdersWhere(req.tenant.id, req.query);
  const rows = await db.order.findMany({ where, select: { stageId: true, buyerId: true, items: { select: { price: true, quantity: true } } }, take: 50000 });
  const by = new Map(); const total = { count: 0, sum: 0, placedCount: 0, placedSum: 0 };
  for (const o of rows) {
    const sum = itemsTotal(o.items);
    const k = o.stageId || '';
    const s = by.get(k) || { stageId: o.stageId, count: 0, sum: 0 };
    s.count += 1; s.sum += sum; by.set(k, s);
    total.count += 1; total.sum += sum;
    if (o.buyerId) { total.placedCount += 1; total.placedSum += sum; }
  }
  res.json({ ok: true, data: { total, stages: [...by.values()], truncated: rows.length >= 50000 } });
}));

// Вивантаження в Excel (2026-11-04, Олексій: «скачати файл із замовленнями — бачити список товарів, які замовили за день»): ті самі фільтри, що у списку,
// лише оформлені замовлення (є покупець). Аркуш «Замовлення» — рядок на замовлення; «Позиції» — рядок на товар (комплект розгорнуто на склад).
const propOf = (props, re) => (Array.isArray(props) ? props : []).filter((p) => p && re.test(String(p.name || ''))).map((p) => p.value).filter(Boolean).join(', ');
router.get('/orders/export.xlsx', asyncHandler(async (req, res) => {
  const where = { ...buildOrdersWhere(req.tenant.id, req.query), buyerId: { not: null } };
  const orders = await db.order.findMany({
    where, orderBy: [{ placedAt: 'desc' }, { createdAt: 'desc' }], take: 5000,
    include: { buyer: true, stage: { select: { name: true } }, firstTouchAd: { select: { name: true } }, payments: PAYMENTS_INCLUDE, items: { include: { supplier: { select: { name: true } }, product: { select: { sku: true } } } } },
  });
  const at = (o) => o.placedAt || o.createdAt;
  const personOf = (o) => (o.buyer && (o.buyer.fullName || o.buyer.phone)) || o.contactName || (o.contactIg ? '@' + o.contactIg : '');
  const PAY = { partial: 'Часткова передплата', full: 'Повна передплата', cod: 'Накладений платіж' };
  const orderRows = orders.map((o) => {
    const total = itemsTotal(o.items);
    const paid = (o.payments || []).filter((p) => isPaidStatus(p.status)).reduce((s, p) => s + Number(p.amount || 0), 0);
    const sh = o.shipping || {};
    return [
      at(o), personOf(o), (o.buyer && o.buyer.phone) || '', (o.buyer && o.buyer.igUsername) || o.contactIg || '',
      [sh.city, sh.branch || sh.warehouse].filter(Boolean).join(', '),
      o.items.map((it) => `${it.name.split('.')[0].trim()} × ${it.quantity}`).join('\n'),
      o.items.reduce((s, it) => s + it.quantity, 0), total, paid, PAY[o.paymentType] || '',
      o.stage ? o.stage.name : '', (o.ttn || []).join(', '), o.ttnStatus || '', o.isRefused ? 'Так' : '',
      o.placedBy || '', (o.firstTouchAd && o.firstTouchAd.name) || o.sourceName || 'органіка', o.managerComment || '',
    ];
  });
  const itemRows = [];
  for (const o of orders) {
    for (const it of o.items) {
      const comps = Array.isArray(it.components) && it.components.length ? it.components : null;
      const parent = at(o);
      if (comps) {
        for (const c of comps) itemRows.push([parent, personOf(o), it.name.split('.')[0].trim(), String(c.name || '').replace(/\.?\s*Артикул:?.*$/i, '').trim(), c.sku || '', c.color || '', c.size || '', (Number(c.qty) || 1) * it.quantity, '', (it.supplier && it.supplier.name) || '', o.stage ? o.stage.name : '', (o.ttn || []).join(', ')]);
      } else {
        itemRows.push([parent, personOf(o), '', it.name.split('.')[0].trim(), (it.product && it.product.sku) || propOf(it.properties, /артикул/i), propOf(it.properties, /кол|цвет/i), propOf(it.properties, /розмір|размер|size/i), it.quantity, Number(it.price) * it.quantity, (it.supplier && it.supplier.name) || '', o.stage ? o.stage.name : '', (o.ttn || []).join(', ')]);
      }
    }
  }
  const buf = buildXlsx([
    { name: 'Замовлення', columns: [
      { header: 'Дата оформлення', fmt: 'date', width: 17 }, { header: 'Покупець', width: 24 }, { header: 'Телефон', width: 16 }, { header: 'Instagram', width: 18 },
      { header: 'Доставка', width: 30 }, { header: 'Товари', fmt: 'wrap', width: 42 }, { header: 'К-сть', fmt: 'int', width: 7 }, { header: 'Сума, грн', fmt: 'money', width: 12 },
      { header: 'Оплачено, грн', fmt: 'money', width: 13 }, { header: 'Оплата', width: 20 }, { header: 'Стадія', width: 28 }, { header: 'ТТН', width: 22 },
      { header: 'Статус НП', width: 30 }, { header: 'Відмова', width: 9 }, { header: 'Хто оформив', width: 18 }, { header: 'Реклама / джерело', width: 30 }, { header: 'Коментар', fmt: 'wrap', width: 30 },
    ], rows: orderRows },
    { name: 'Позиції', columns: [
      { header: 'Дата оформлення', fmt: 'date', width: 17 }, { header: 'Покупець', width: 24 }, { header: 'Комплект', width: 18 }, { header: 'Товар', width: 34 }, { header: 'Артикул', width: 14 },
      { header: 'Колір', width: 14 }, { header: 'Розмір', width: 9 }, { header: 'К-сть', fmt: 'int', width: 7 }, { header: 'Сума, грн', fmt: 'money', width: 12 }, { header: 'Постачальник', width: 18 }, { header: 'Стадія', width: 28 }, { header: 'ТТН', width: 22 },
    ], rows: itemRows },
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  const period = [req.query.ftFrom, req.query.ftTo].filter(Boolean).join('_');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="orders_${period || stamp}.xlsx"`);
  res.send(buf);
}));

router.get('/orders/:id', asyncHandler(async (req, res) => {
  const order = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { ...ORDER_INCLUDE, payments: PAYMENTS_INCLUDE } });
  if (!order) throw new NotFoundError('Order', req.params.id);
  res.json({ ok: true, data: withPaidSum(order) });
}));

router.patch('/orders/:id', asyncHandler(async (req, res) => {
  const existing = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { items: { select: { price: true, quantity: true } }, buyer: true } });
  if (!existing) throw new NotFoundError('Order', req.params.id);
  const b = req.body || {};
  // Оплата (2026-10-18): спосіб + передплата; «повна» = сума позицій замовлення.
  const payFields = paymentFields(b, itemsTotal(existing.items), existing, req.tenant.prepaymentAmount);
  // ТТН: рядок або масив, замінює список. Нова ТТН → «Відправлено», якщо замовлення туди ще не дійшло і стадію не задано явно.
  const ttnList = b.ttn !== undefined ? parseTtnList(b.ttn) : null;
  const stagePatch = ttnList && b.stageId === undefined ? await shippedStagePatch(req.tenant.id, existing, existing.ttn, ttnList) : {};
  const buyerPatch = b.buyer !== undefined ? await applyBuyerEdit(req.tenant.id, existing, b.buyer) : {};
  // Перехід з ранньої стадії на стадію-замовлення (Stage.countsAsOrder) — це й є оформлення: дата оформлення = цей момент.
  const acceptPatch = await acceptancePatch(existing.stageId, b.stageId !== undefined ? b.stageId : stagePatch.stageId, existing.buyerId || buyerPatch.buyerId);
  const order = await db.order.update({
    where: { id: existing.id },
    data: {
      ...payFields,
      ...stagePatch,
      ...buyerPatch,
      ...acceptPatch,
      ...(b.contactName !== undefined ? { contactName: b.contactName ? String(b.contactName) : null } : {}),
      ...(b.contactIg !== undefined ? { contactIg: igOrNull(b.contactIg) } : {}),
      ...(b.stageId !== undefined ? { stageId: b.stageId } : {}),
      ...(b.managerComment !== undefined ? { managerComment: b.managerComment } : {}),
      ...(b.shipping !== undefined ? { shipping: b.shipping } : {}),
      // Доставку змінив менеджер (не воронка) — Flows покаже це в перевірці перед «Оформити постачальнику».
      ...(b.shipping !== undefined && b.source !== 'funnel' ? { managerEditedAt: new Date() } : {}),
      ...(ttnList ? { ttn: ttnList } : {}),
      ...(b.sourceName !== undefined ? { sourceName: b.sourceName } : {}),
      ...(b.isRefused !== undefined ? { isRefused: !!b.isRefused } : {}),
      // «Змінити дату» (Edits c4fc2dcd): дата оформлення — лише явно; інші правки її не чіпають.
      ...(b.placedAt !== undefined ? { placedAt: placedAtFrom(b.placedAt) } : {}),
      ...(b.placedBy !== undefined ? { placedBy: b.placedBy ? String(b.placedBy).trim().slice(0, 80) : null } : {}),
      // Покупець зʼявився вперше (картку перетворили на замовлення вручну) — це оформлення.
      ...(!existing.buyerId && buyerPatch.buyerId && !existing.placedAt && b.placedAt === undefined ? { placedAt: new Date(), placedBy: existing.placedBy || placedByFrom(b, req, false) } : {}),
    },
    include: ORDER_INCLUDE,
  });
  res.json({ ok: true, data: order, ...(stagePatch.stageId ? { movedToStage: order.stage?.name || null } : {}) });
}));

// Видалити замовлення (2026-11-06, Олексій): м'яке — зникає зі списку й усіх звітів, у базі лишається (платежі, ТТН). Працює і для оформлених.
// POST /orders/:id/cancel лишено як синонім (старі клієнти API/MCP): «скасоване» тепер теж просто видалене зі звітів.
const deletedBy = (req) => (req.user && req.user.name) || null;
router.delete('/orders/:id', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await deleteOrder(req.tenant.id, req.params.id, deletedBy(req)) });
}));
router.post('/orders/:id/cancel', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await deleteOrder(req.tenant.id, req.params.id, deletedBy(req)) });
}));
router.post('/orders/:id/restore', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await restoreOrder(req.tenant.id, req.params.id) });
}));

// Заміна позицій замовлення (2026-10-02): менеджер правит склад у картці замовлення («Редагувати» з Telegram), а Flows
// при «Оформити постачальнику» бере позиції саме звідси. Усі позиції замінюються атомарно. source:'funnel' — запис
// від воронки (склад комплекту при створенні), не позначається як правка менеджера.
function cleanComponent(c) {
  return {
    productId: c && c.productId ? String(c.productId) : null,
    sku: String((c && c.sku) || '').trim(),
    name: String((c && c.name) || '').trim().slice(0, 300),
    color: String((c && c.color) || '').trim().slice(0, 80),
    size: String((c && c.size) || '').trim().slice(0, 40),
    qty: Math.max(1, parseInt(c && c.qty, 10) || 1),
  };
}
router.put('/orders/:id/items', asyncHandler(async (req, res) => {
  const existing = await db.order.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { items: { select: { productId: true, supplierId: true } } } });
  if (!existing) throw new NotFoundError('Order', req.params.id);
  const b = req.body || {};
  if (!Array.isArray(b.items) || !b.items.length) throw new ValidationError('Потрібна хоча б одна позиція');
  // Постачальник позиції (2026-10-18): явно з форми; не передано (запис від воронки) → як було, інакше з каталогу.
  const suppliers = await resolveItemSuppliers(req.tenant.id, b.items, existing.items);
  const items = b.items.map((it, i) => {
    const name = String((it && it.name) || '').trim();
    const price = Number(it && it.price);
    const quantity = parseInt(it && it.quantity, 10);
    if (!name) throw new ValidationError(`Позиція ${i + 1}: немає назви`);
    if (!Number.isFinite(price) || price < 0) throw new ValidationError(`Позиція ${i + 1}: неправильна ціна`);
    if (!(quantity >= 1)) throw new ValidationError(`Позиція ${i + 1}: кількість має бути від 1`);
    const props = Array.isArray(it.properties) ? it.properties.filter((p) => p && p.name && String(p.value || '').trim()).map((p) => ({ name: String(p.name), value: String(p.value).trim() })) : [];
    const comps = Array.isArray(it.components) ? it.components.map(cleanComponent).filter((c) => c.sku || c.productId) : [];
    return {
      orderId: existing.id,
      productId: it.productId || null,
      offerId: it.offerId || null,
      name: name.slice(0, 500),
      price,
      quantity,
      properties: props.length ? props : undefined,
      components: comps.length ? comps : undefined,
      isUpsell: !!it.isUpsell,
      supplierId: suppliers[i],
    };
  });
  // «Повна передплата» йде за сумою замовлення — змінився склад, змінилась і передплата.
  const orderData = {
    ...(b.source === 'funnel' ? {} : { managerEditedAt: new Date() }),
    ...(existing.paymentType === 'full' ? { prepaymentAmount: Math.round(itemsTotal(items) * 100) / 100 } : {}),
  };
  await db.$transaction([
    db.orderItem.deleteMany({ where: { orderId: existing.id } }),
    db.orderItem.createMany({ data: items }),
    ...(Object.keys(orderData).length ? [db.order.update({ where: { id: existing.id }, data: orderData })] : []),
  ]);
  const order = await db.order.findFirst({ where: { id: existing.id }, include: ORDER_INCLUDE });
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
  let { firstTouchAdId, lastTouchAdId } = req.body || {};
  // Ручний вибір варіанта Advantage+ («_Group_1») зараховуємо справжньому оголошенню (lib/adVariants.js).
  if (firstTouchAdId) firstTouchAdId = await canonicalAdId(req.tenant.id, firstTouchAdId);
  if (lastTouchAdId) lastTouchAdId = await canonicalAdId(req.tenant.id, lastTouchAdId);
  const order = await db.order.update({
    where: { id: existing.id },
    data: {
      // Ручний вибір реклами — дата дотику лишається датою розмови/замовлення, не днем правки (Edits c4fc2dcd: замовлення 20.10
      // «переїхало» на 23.10, коли 23.10 вказали рекламу).
      ...(firstTouchAdId !== undefined ? { firstTouchAdId, firstTouchAt: firstTouchAdId ? (existing.firstTouchAt || existing.createdAt) : null } : {}),
      ...(lastTouchAdId !== undefined ? { lastTouchAdId, lastTouchAt: lastTouchAdId ? (existing.lastTouchAt || existing.placedAt || existing.createdAt) : null } : {}),
    },
  });
  res.json({ ok: true, data: order });
}));

// Дотики реклами за розмовою воронки (Meta-id) — для бекфілу з історії Flows і будь-якого входу, де відомий лише sessionId.
// Та сама логіка, що в картці /funnel-events: firstTouch не перезаписується, lastTouch — лише новіший.
router.post('/orders/attribution-by-session', asyncHandler(async (req, res) => {
  const { sessionId, firstTouch, lastTouch } = req.body || {};
  if (!sessionId) throw new ValidationError('sessionId обовʼязковий');
  const order = await db.order.findFirst({ where: { tenantId: req.tenant.id, funnelSessionId: String(sessionId) } });
  if (!order) return void res.json({ ok: true, data: null, reason: 'no_order_for_session' });
  const data = await touchFields(req.tenant.id, { firstTouch, lastTouch }, order);
  if (!Object.keys(data).length) return void res.json({ ok: true, data: { id: order.id, unchanged: true } });
  const upd = await db.order.update({ where: { id: order.id }, data, select: { id: true, firstTouchAdId: true, lastTouchAdId: true } });
  res.json({ ok: true, data: upd });
}));

module.exports = router;
