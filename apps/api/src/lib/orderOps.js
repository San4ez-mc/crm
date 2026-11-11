// Ручна робота менеджера із замовленням (2026-10-18, правки Олексія): спосіб оплати й передплата, постачальник позиції,
// ТТН із переходом у «Відправлено», скасування й видалення помилкового замовлення. Одне місце для REST (routes/orders.js)
// і MCP (apps/mcp/src/tools.js), щоб правила не розходились.
const { db } = require('@crm/db');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { igOrNull } = require('./instagram');

// ── Оплата ───────────────────────────────────────────────────────────────
const PAYMENT_TYPES = ['partial', 'full', 'cod'];
const PAYMENT_TYPE_LABEL = { partial: 'Часткова передплата', full: 'Повна передплата', cod: 'Накладений платіж без передплати' };
const DEFAULT_PREPAYMENT = 200;

function itemsTotal(items) {
  return (items || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);
}

/**
 * Поля оплати для запису в Order. b = {paymentType?, prepaymentAmount?}; total — сума позицій замовлення;
 * existing — поточне замовлення (для часткового оновлення). Нічого не передано → {} (не чіпаємо).
 * full → передплата = сума замовлення; cod → 0; partial → вказана сума (за замовчуванням — передоплата з налаштувань магазину,
 * defaultPrepayment; не задано — 200 грн), не більша за суму.
 */
function paymentFields(b, total, existing = null, defaultPrepayment = null) {
  const hasType = b.paymentType !== undefined;
  const hasAmount = b.prepaymentAmount !== undefined;
  if (!hasType && !hasAmount) return {};
  if (hasType && (b.paymentType === null || b.paymentType === '')) return { paymentType: null, prepaymentAmount: null };
  const type = hasType ? String(b.paymentType) : (existing?.paymentType || 'partial');
  if (!PAYMENT_TYPES.includes(type)) throw new ValidationError(`paymentType має бути одним із: ${PAYMENT_TYPES.join(', ')}`);
  if (type === 'full') return { paymentType: type, prepaymentAmount: round2(total) };
  if (type === 'cod') return { paymentType: type, prepaymentAmount: 0 };
  let amount;
  if (hasAmount && b.prepaymentAmount !== null && b.prepaymentAmount !== '') amount = Number(b.prepaymentAmount);
  else if (existing?.paymentType === 'partial' && existing.prepaymentAmount != null) amount = Number(existing.prepaymentAmount);
  else amount = Number(defaultPrepayment) > 0 ? Number(defaultPrepayment) : DEFAULT_PREPAYMENT; // налаштування магазину, інакше 200
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('Сума передплати має бути більшою за 0');
  if (total > 0 && amount > total) throw new ValidationError(`Передплата ${amount} грн більша за суму замовлення ${round2(total)} грн — оберіть «Повна передплата»`);
  return { paymentType: type, prepaymentAmount: round2(amount) };
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ── Постачальник позиції ─────────────────────────────────────────────────
/**
 * supplierId для кожної позиції: явно передано (it.supplierId, '' / null = прибрати) → його (лише постачальник цього
 * магазину); не передано → як було в цій позиції раніше (за productId, щоб повторний запис позицій воронкою не стер
 * вибір менеджера) → постачальник товару з каталогу. Два запити на весь список, не на позицію (CLAUDE.md §9.5).
 */
async function resolveItemSuppliers(tenantId, items, previousItems = []) {
  const explicit = [...new Set(items.map((it) => it && it.supplierId).filter(Boolean).map(String))];
  if (explicit.length) {
    const found = await db.supplier.findMany({ where: { tenantId, id: { in: explicit } }, select: { id: true } });
    const ok = new Set(found.map((s) => s.id));
    const bad = explicit.filter((id) => !ok.has(id));
    if (bad.length) throw new ValidationError('Постачальника не знайдено в цьому магазині', { supplierIds: bad });
  }
  const prevByProduct = new Map((previousItems || []).filter((p) => p.productId && p.supplierId).map((p) => [p.productId, p.supplierId]));
  const needCatalog = [...new Set(items.filter((it) => it && it.supplierId === undefined && it.productId && !prevByProduct.has(it.productId)).map((it) => String(it.productId)))];
  const catalog = needCatalog.length
    ? new Map((await db.product.findMany({ where: { tenantId, id: { in: needCatalog } }, select: { id: true, supplierId: true } })).map((p) => [p.id, p.supplierId]))
    : new Map();
  return items.map((it) => {
    if (it && it.supplierId !== undefined) return it.supplierId ? String(it.supplierId) : null;
    if (it && it.productId && prevByProduct.has(it.productId)) return prevByProduct.get(it.productId);
    return (it && it.productId && catalog.get(String(it.productId))) || null;
  });
}

// ── ТТН ──────────────────────────────────────────────────────────────────
/** ТТН з поля форми: масив або рядок «204500…, 204500…» → унікальні непорожні номери. */
function parseTtnList(v) {
  const raw = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[\s,;]+/);
  return [...new Set(raw.map((x) => String(x == null ? '' : x).trim()).filter(Boolean))].slice(0, 10);
}

// ── Стадії за змістом ────────────────────────────────────────────────────
// Стадії в кожного магазину свої (назви задає власник на сторінці «Воронки»), тож шукаємо за назвою. Нових стадій
// мовчки не створюємо: нема відповідної — кажемо, яку додати.
const STAGE_MATCHERS = {
  // «Скасовано» пріоритетніше за «Відмова» (у CRM «відмова» — ще й позначка «не забрав на НП», isRefused).
  cancelled: [(n) => /скасов|cancel/.test(n), (n) => /^відмов/.test(n)],
  shipped: [(n) => /відправлен/.test(n) && !/не\s+відправ/.test(n), (n) => /^в\s+дорозі|^shipped/.test(n)],
  // 2026-11-04 (Олексій): замовлення вже у постачальника, але посилку ще не передано Новій пошті («створена, не передана до відправки»).
  supplier: [(n) => /оформлен\S*\s+в\s+постачальник/.test(n)],
  // Посилка прибула у відділення/поштомат і чекає на клієнта (код НП 7/8) — окрема стадія, щоб «Не забрав на пошті» означало лише відмову.
  stored: [(n) => /зберігаєть/.test(n)],
};
// Стадії ПІСЛЯ відправлення за змістом (а не за порядком: у goverla «оформлене в постачальника» стоїть у списку після
// «Відправлено», хоча йде до нього) — ТТН замовлення з них не повертає назад у «Відправлено».
const AFTER_SHIPPED = (n) => /забрав|отрима|поверн|обмін|заверш|викона|доставлен|скасов|^відмов|cancel|complete|deliver|return/.test(n);
async function findStage(tenantId, kind, preferPipelineId = null) {
  const pipelines = await db.pipeline.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { order: 'asc' } } } });
  const ordered = preferPipelineId ? [...pipelines.filter((p) => p.id === preferPipelineId), ...pipelines.filter((p) => p.id !== preferPipelineId)] : pipelines;
  for (const match of STAGE_MATCHERS[kind]) {
    for (const p of ordered) {
      const hit = p.stages.find((s) => match(String(s.name || '').trim().toLowerCase()));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Нова ТТН → стадія «Замовлення оформлене в постачальника» (2026-11-04, Олексій: постачальник ще кілька днів шиє замовлення і може
 * його скасувати — «Відправлено» ставить CRM сама, коли Нова пошта покаже, що посилка в дорозі: lib/novaPoshta.js). Немає такої стадії
 * в магазині — як раніше, «Відправлено». Рухаємо лише вперед, за змістом назви, не за порядком: не чіпаємо замовлення, що вже
 * «Відправлено»/«Зберігається»/«Забрав»/«Повернення»/скасовані. Повертає {stageId} або {}.
 */
async function shippedStagePatch(tenantId, order, oldTtn, newTtn) {
  const added = newTtn.filter((t) => !(oldTtn || []).includes(t));
  if (!added.length) return {};
  const current = order.stageId ? await db.stage.findUnique({ where: { id: order.stageId } }) : null;
  const pipelineId = current?.pipelineId || null;
  const target = (await findStage(tenantId, 'supplier', pipelineId)) || (await findStage(tenantId, 'shipped', pipelineId));
  if (!target || (current && current.id === target.id)) return {};
  if (current) {
    const cancelled = await findStage(tenantId, 'cancelled', current.pipelineId);
    if (cancelled && cancelled.id === current.id) return {};
    const cur = String(current.name || '').trim().toLowerCase();
    if (AFTER_SHIPPED(cur) || (/відправлен/.test(cur) && !/не\s+відправ/.test(cur)) || /зберігаєть/.test(cur)) return {};
  }
  return { stageId: target.id };
}

// ── Покупець із форми замовлення ─────────────────────────────────────────
/**
 * Дані клієнта з форми редагування замовлення (2026-10-18, Олексій: «не дає відредагувати посилання на клієнта»).
 * input = {fullName?, phone?, igUsername?}. Є покупець → оновлюємо його (той самий клієнт в усіх його замовленнях); новий
 * телефон уже належить іншому покупцю → перепривʼязуємо замовлення до нього. Покупця нема, але вказано телефон → знаходимо/
 * створюємо. Без телефону — лише імʼя/нікнейм на картці (contactName/contactIg). Повертає поля для order.update.
 */
async function applyBuyerEdit(tenantId, order, input) {
  if (!input || typeof input !== 'object') return {};
  const has = (k) => input[k] !== undefined;
  const ig = has('igUsername') ? igOrNull(input.igUsername) : undefined;
  if (has('igUsername') && input.igUsername && !ig) throw new ValidationError(`Не вдалося розпізнати Instagram-нікнейм у «${String(input.igUsername).slice(0, 80)}» — вставте посилання на профіль або нікнейм`);
  const fullName = has('fullName') ? (String(input.fullName || '').trim() || null) : undefined;
  const phone = has('phone') ? String(input.phone || '').replace(/[^\d+]/g, '') : undefined;
  const cardFields = { ...(ig !== undefined ? { contactIg: ig } : {}), ...(fullName ? { contactName: fullName } : {}) };
  const buyerData = { ...(fullName !== undefined ? { fullName } : {}), ...(ig !== undefined ? { igUsername: ig } : {}) };

  let target = order.buyer || null;
  if (phone && (!target || target.phone !== phone)) {
    const other = await db.buyer.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
    if (other) target = other;
    else if (target) buyerData.phone = phone;
    else target = await db.buyer.create({ data: { tenantId, phone, fullName: fullName || null, igUsername: ig || null } });
  } else if (phone !== undefined && !phone && target) {
    throw new ValidationError('Телефон покупця не може бути порожнім');
  }
  if (!target) return cardFields;
  if (Object.keys(buyerData).length) await db.buyer.update({ where: { id: target.id }, data: buyerData });
  return { ...cardFields, buyerId: target.id };
}

// ── Скасування / видалення ───────────────────────────────────────────────
/**
 * Видалити замовлення (2026-11-06, Олексій: кнопка «Видалити» навіть для оформленого — клієнт оплатив і передумав, або постачальник скасував).
 * Завжди м'яке: рядок лишається в базі разом з платежами, ТТН і повʼязаним покупцем, але зникає зі списку, дошки, Excel і ВСІХ звітів
 * (lib/margin ORDER_PLACED_WHERE / LEAD_WHERE). Раніше було дві дії — «Скасувати» (стадія «Скасовано», яка лишалась у статистиці) і жорстке
 * видалення (заборонене, якщо є ТТН/оплата); обидві замінені цією однією. Відновити можна (restoreOrder).
 */
async function deleteOrder(tenantId, orderId, by = null) {
  const order = await db.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true, deletedAt: true } });
  if (!order) throw new NotFoundError('Order', orderId);
  if (order.deletedAt) return { id: order.id, deleted: true, unchanged: true };
  await db.order.update({ where: { id: order.id }, data: { deletedAt: new Date(), deletedBy: by ? String(by).slice(0, 80) : null } });
  return { id: order.id, deleted: true };
}

/** Повернути видалене замовлення на дошку й у звіти. */
async function restoreOrder(tenantId, orderId) {
  const order = await db.order.findFirst({ where: { id: orderId, tenantId }, select: { id: true } });
  if (!order) throw new NotFoundError('Order', orderId);
  await db.order.update({ where: { id: order.id }, data: { deletedAt: null, deletedBy: null } });
  return { id: order.id, deleted: false };
}

// ── Стадії-«замовлення» (2026-11-11) ─────────────────────────────────────────────────────────────────────────────────
// Картка з покупцем на ранній стадії (Stage.countsAsOrder=false) ще не замовлення. Коли вона вперше потрапляє на стадію-замовлення
// (прийняте / оформлене в постачальника), дата оформлення (placedAt) стає моментом цього переходу — так «замовлень за сьогодні»
// не змінюється заднім числом і збігається з тим, що менеджер бачить на дошці.
async function acceptancePatch(prevStageId, nextStageId, buyerId) {
  if (!buyerId || !nextStageId || prevStageId === nextStageId) return {};
  const ids = [prevStageId, nextStageId].filter(Boolean);
  const st = await db.stage.findMany({ where: { id: { in: ids } }, select: { id: true, countsAsOrder: true } });
  const prev = st.find((x) => x.id === prevStageId); const next = st.find((x) => x.id === nextStageId);
  return prev && next && prev.countsAsOrder === false && next.countsAsOrder !== false ? { placedAt: new Date() } : {};
}

const PAID_STATUS_RE = /^(success|paid|ok|completed|confirmed)$/i;

/** Оплата прийшла, а картка ще на ранній стадії («Очікуємо дані та оплату») → переносимо на першу стадію-замовлення тієї ж воронки.
 *  Повертає стадію, на яку перенесли, або null. */
async function moveToAcceptedOnPayment(order, payment) {
  if (!order || !order.buyerId || order.deletedAt || !(Number(payment && payment.amount) > 0) || !PAID_STATUS_RE.test(String((payment && payment.status) || 'success'))) return null;
  const cur = order.stageId ? await db.stage.findUnique({ where: { id: order.stageId }, select: { id: true, pipelineId: true, countsAsOrder: true } }) : null;
  if (!cur || cur.countsAsOrder !== false) return null;
  const target = await db.stage.findFirst({ where: { pipelineId: cur.pipelineId, countsAsOrder: true }, orderBy: { order: 'asc' } });
  if (!target) return null;
  await db.order.update({ where: { id: order.id }, data: { stageId: target.id, placedAt: new Date() } });
  return target;
}

module.exports = {
  acceptancePatch, moveToAcceptedOnPayment,
  PAYMENT_TYPES, PAYMENT_TYPE_LABEL, DEFAULT_PREPAYMENT,
  itemsTotal, paymentFields, resolveItemSuppliers, parseTtnList,
  findStage, shippedStagePatch, applyBuyerEdit, deleteOrder, restoreOrder,
};
