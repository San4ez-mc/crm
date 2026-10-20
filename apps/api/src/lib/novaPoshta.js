// Статуси посилок Нової пошти — CRM опитує сама (2026-10-20, власник: «нехай не бот бере, а СРМ, щоб статус одразу в СРМ
// оновився, бот має брати тільки звідти»). Раніше це робив Flows-крон (np-ttn-status-goverla) через REST CRM: брав лише 500
// останніх рядків /orders (а це здебільшого картки розмов) і пропускав «оформлене в постачальника» — 97 зі 168 замовлень з ТТН
// за 14 днів лишались без статусу. Тепер: вибірка з БД (усі оформлені з ТТН, не в кінцевих стадіях), запит до НП пачками до
// 100 номерів, статус + очікувана дата доставки в замовлення, стадія — лише вперед.
//
// Коди НП (TrackingDocument.getStatusDocuments, перевірено живими ТТН 12.09): 1 — створена, не передана; 2 — видалена;
// 3 — не знайдена; 4/41/5/6/101/104/112 — у дорозі; 7/8 — у відділенні/поштоматі; 9/10/11 (або RecipientDateTime) — отримана;
// 102/103/106/108 — відмова/повернення (стадію не чіпаємо — це рішення менеджера).
const { db } = require('@crm/db');
const logger = require('@crm/logger');
const { findStage } = require('./orderOps');

const NP_URL = 'https://api.novaposhta.ua/v2.0/json/';
const BATCH = 100;
const LOOKBACK_DAYS = 60;

/** Сирі статуси НП за списком ТТН → Map(ttn → документ НП). Помилка мережі/ключа — кидає. */
async function npStatuses(apiKey, ttns, timeoutMs = 8000) {
  const out = new Map();
  for (let i = 0; i < ttns.length; i += BATCH) {
    const chunk = ttns.slice(i, i + BATCH);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(NP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ apiKey, modelName: 'TrackingDocument', calledMethod: 'getStatusDocuments', methodProperties: { Documents: chunk.map((n) => ({ DocumentNumber: n, Phone: '' })) } }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j || j.success === false) throw new Error('НП: ' + ((j && (j.errors || []).join('; ')) || ('HTTP ' + r.status)));
      for (const d of j.data || []) if (d && d.Number) out.set(String(d.Number), d);
    } finally { clearTimeout(timer); }
  }
  return out;
}

/** Що означає статус НП для стадії: picked | arrived | moving | null (створена/видалена/не знайдена/відмова — стадію не рухаємо). */
function npOutcome(d) {
  const code = String(d && d.StatusCode || '');
  if (['102', '103', '106', '108'].includes(code)) return null;
  if ((d.RecipientDateTime && String(d.RecipientDateTime).trim()) || ['9', '10', '11'].includes(code)) return 'picked';
  if (['7', '8'].includes(code)) return 'arrived';
  if (['4', '41', '5', '6', '101', '104', '112'].includes(code)) return 'moving';
  return null;
}

/** «23-10-2026 15:00:00» (так віддає getStatusDocuments) / «2026-10-23» / «23.10.2026» з НП → Date (день) або null. */
function npDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 9));
  m = s.match(/^(\d{2})[.-](\d{2})[.-](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 9));
  return null;
}

// Кінцеві стадії — статус НП ще оновлюємо (клієнт може спитати), але стадію не чіпаємо. Звідки рухаємо — лише вперед за змістом.
const FINAL = (n) => /забрав\s+на\s+пошті|отрима|поверн|обмін|заверш|викона|скасов|^відмов|не\s+відписали|cancel|complete|return/.test(n) && !/не\s+забрав/.test(n);
const RANK = { moving: 1, arrived: 2, picked: 3 };
const rankOf = (n) => (/клієнт\s+забрав|^забрав|отрима/.test(n) && !/не\s+забрав/.test(n) ? 3 : /не\s+забрав/.test(n) ? 2 : /відправлен/.test(n) && !/не\s+відправ/.test(n) ? 1 : 0);

async function outcomeStages(tenantId) {
  const pipelines = await db.pipeline.findMany({ where: { tenantId }, include: { stages: true } });
  const all = pipelines.flatMap((p) => p.stages);
  const by = (re, not) => all.find((s) => { const n = String(s.name || '').trim().toLowerCase(); return re.test(n) && !(not && not.test(n)); }) || null;
  return { moving: await findStage(tenantId, 'shipped'), arrived: by(/не\s+забрав/), picked: by(/клієнт\s+забрав|^забрав|отримав/, /не\s+забрав/) };
}

/**
 * Оновити статуси ТТН замовлень магазину з Нової пошти.
 * opts.orderIds — лише ці замовлення; opts.maxAgeMs — пропускати, якщо статус свіжіший; opts.moveStages (за замовч. true).
 * Повертає {checked, updated, moved:[{orderId, ttn, to, name}], skipped?}.
 */
async function syncTtnStatuses(tenantId, opts = {}) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { novaPoshtaApiKey: true } });
  const apiKey = String((tenant && tenant.novaPoshtaApiKey) || '').trim();
  if (!apiKey) return { checked: 0, updated: 0, moved: [], skipped: 'немає ключа Нової пошти в налаштуваннях магазину' };
  const where = { tenantId, buyerId: { not: null }, ttn: { isEmpty: false }, createdAt: { gt: new Date(Date.now() - LOOKBACK_DAYS * 864e5) } };
  if (Array.isArray(opts.orderIds)) where.id = { in: opts.orderIds };
  if (opts.maxAgeMs) where.OR = [{ ttnStatusAt: null }, { ttnStatusAt: { lt: new Date(Date.now() - opts.maxAgeMs) } }];
  const orders = await db.order.findMany({ where, select: { id: true, ttn: true, ttnStatus: true, stageId: true, stage: { select: { name: true } }, contactName: true, buyer: { select: { fullName: true } } } });
  if (!orders.length) return { checked: 0, updated: 0, moved: [] };
  const lastTtn = (o) => String(o.ttn[o.ttn.length - 1]);
  const docs = await npStatuses(apiKey, [...new Set(orders.map(lastTtn))], opts.timeoutMs);
  const stages = opts.moveStages === false ? null : await outcomeStages(tenantId);
  const res = { checked: 0, updated: 0, moved: [] };
  for (const o of orders) {
    const ttn = lastTtn(o);
    const d = docs.get(ttn);
    if (!d) continue;
    res.checked++;
    const data = { ttnStatus: String(d.Status || '').trim() || o.ttnStatus, ttnStatusAt: new Date(), ttnEta: npDate(d.ScheduledDeliveryDate) || npDate(d.ActualDeliveryDate) };
    const outcome = npOutcome(d);
    const cur = String((o.stage && o.stage.name) || '').trim().toLowerCase();
    const target = stages && outcome ? stages[outcome] : null;
    if (target && target.id !== o.stageId && !FINAL(cur) && RANK[outcome] > rankOf(cur)) {
      data.stageId = target.id;
      res.moved.push({ orderId: o.id, ttn, to: outcome, stage: target.name, name: (o.buyer && o.buyer.fullName) || o.contactName || null });
    }
    await db.order.update({ where: { id: o.id }, data });
    res.updated++;
  }
  if (res.moved.length) logger.info('НП: статуси оновлено', { tenantId, checked: res.checked, moved: res.moved.length });
  return res;
}

module.exports = { npStatuses, npOutcome, npDate, syncTtnStatuses };
