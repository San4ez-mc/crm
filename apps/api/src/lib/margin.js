// Спільна формула маржі по позиції замовлення — той самий підхід, що в
// /analytics/margin і /analytics/daily (apps/api/src/routes/analytics.js): дохід −
// собівартість − ЗП менеджера (fixed+percent). Винесено сюди 2026-09-03, щоб не
// дублювати в новому per-оголошення звіті (routes/ads.js).
const { db } = require('@crm/db');

// Мапа productId → ProductExpense. Додатково на неї навішено (2026-11-06, Edits Олексія «комплект не віднімає дроп-ціну»):
//   .skuToId — артикул товару → productId (склад комплекту в замовленні часто лише з артикулом);
//   .setDefs — productId комплекту → [{componentProductId, qty}] (склад комплекту з каталогу).
// Комплект не має власної ціни постачальника: його собівартість = сума собівартостей речей усередині (itemUnitCost нижче).
async function loadExpenseMap(tenantId) {
  const [rows, products, setRows] = await Promise.all([
    db.productExpense.findMany({ where: { tenantId } }),
    db.product.findMany({ where: { tenantId }, select: { id: true, sku: true } }),
    db.productSetComponent.findMany({ where: { parent: { tenantId } }, select: { parentProductId: true, componentProductId: true, qty: true } }),
  ]);
  const map = new Map(rows.map((r) => [r.productId, r]));
  map.skuToId = new Map(products.filter((p) => p.sku).map((p) => [String(p.sku).trim().toLowerCase(), p.id]));
  map.setDefs = new Map();
  for (const s of setRows) {
    const arr = map.setDefs.get(s.parentProductId) || [];
    arr.push({ productId: s.componentProductId, qty: s.qty || 1 });
    map.setDefs.set(s.parentProductId, arr);
  }
  return map;
}

// Склад позиції-комплекту: спершу те, що записано в самій позиції замовлення (менеджер/бот міг змінити склад),
// інакше склад комплекту з каталогу. Порожньо — це звичайний товар.
function setParts(item, expenseByProduct) {
  const own = Array.isArray(item.components) ? item.components : [];
  const parts = [];
  for (const c of own) {
    const id = (c && c.productId) || (c && c.sku && expenseByProduct.skuToId && expenseByProduct.skuToId.get(String(c.sku).trim().toLowerCase())) || null;
    if (id) parts.push({ productId: id, qty: Math.max(1, parseInt(c.qty, 10) || 1) });
  }
  if (parts.length) return parts;
  const def = item.productId && expenseByProduct.setDefs ? expenseByProduct.setDefs.get(item.productId) : null;
  return def && def.length ? def : [];
}

/**
 * Скільки ШТУК товару в позиції (Edits 08–09.11, Олексій: «кількість товарів — уся кількість, незалежно комплект чи ні»).
 * Звичайний товар: його кількість. Комплект: сума штук по складу (у комплекті не обовʼязково 2 речі) × кількість комплектів.
 */
function itemPieces(item, expenseByProduct) {
  const qty = Number(item.quantity) || 1;
  const parts = setParts(item, expenseByProduct);
  return parts.length ? parts.reduce((s, p) => s + (Number(p.qty) || 1), 0) * qty : qty;
}

/**
 * Собівартість і ставки менеджера ОДНІЄЇ штуки позиції на дату замовлення.
 * Звичайний товар — його ProductExpense. Комплект — сума по речах всередині (кожна за своєю ціною постачальника на дату); якщо
 * речі не мають витрат (сума 0), лишається власний рядок витрат комплекту. Фікс менеджера комплекту = сума фіксів речей;
 * % менеджера = середній по речах, зважений на їхню собівартість (поровну, якщо собівартості нема).
 */
function itemUnit(item, expenseByProduct, atDate) {
  const own = item.productId ? expenseByProduct.get(item.productId) : null;
  const parts = setParts(item, expenseByProduct);
  if (parts.length) {
    let cogs = 0; let fixed = 0; let pctWeighted = 0; let weight = 0; let pctPlain = 0;
    for (const p of parts) {
      const e = expenseByProduct.get(p.productId);
      const c = cogsAt(e, atDate) * p.qty;
      cogs += c; fixed += Number(e?.managerCostFixed || 0) * p.qty;
      pctWeighted += Number(e?.managerCostPercent || 0) * c; weight += c; pctPlain += Number(e?.managerCostPercent || 0);
    }
    if (cogs > 0) return { cogs, fixed, percent: weight > 0 ? pctWeighted / weight : pctPlain / parts.length };
  }
  return { cogs: cogsAt(own, atDate), fixed: Number(own?.managerCostFixed || 0), percent: Number(own?.managerCostPercent || 0) };
}

// ДОПОВНЕННЯ 2026-09-07 (фідбек власника): ціна постачальника міняється в часі —
// ProductExpense.cogsHistory = [{cost, validFrom}], відсортовано за зростанням validFrom.
// Маржа замовлення рахується за ціною, що ДІЯЛА на дату замовлення, а не поточною —
// інакше зміна ціни постачальника заднім числом перекручує вже "закриту" історичну маржу.
// exp.cogs лишається як кеш поточної ціни (для місць, де дата не потрібна) і як фолбек для
// товарів, створених ДО появи cogsHistory (порожній масив).
function cogsAt(exp, atDate) {
  if (!exp) return 0;
  const history = Array.isArray(exp.cogsHistory) ? exp.cogsHistory : [];
  if (history.length === 0) return Number(exp.cogs || 0);
  const at = atDate ? new Date(atDate).getTime() : Date.now();
  let active = null;
  for (const h of history) {
    const vf = new Date(h.validFrom).getTime();
    if (vf <= at && (!active || vf > new Date(active.validFrom).getTime())) active = h;
  }
  // Замовлення старіше за найранішу відому зміну ціни — беремо найдавніший запис (краще
  // наближення, ніж 0).
  if (!active) active = history.reduce((a, b) => (new Date(a.validFrom) <= new Date(b.validFrom) ? a : b));
  return Number(active.cost || 0);
}

// 2026-09-05 (правило власника): ЗП менеджера — 10% (managerCostPercent) від НАЦІНКИ
// (виручка − собівартість), НЕ від усієї виручки як було раніше; і 0 повністю (і fixed,
// і percent), якщо замовлення відмовлене на Новій Пошті — менеджер за відмову не отримує
// нічого. COGS/виручка при цьому НЕ зануляються — питання "хто платить за зворотну
// доставку" ще не узгоджене (див. коментар при Order.isRefused), тут лише ЗП менеджера.
// atDate — дата замовлення (для date-aware cogsHistory); якщо не передано явно, пробуємо
// взяти item.order.createdAt (зручно, коли item прийшов із include: {order}).
function marginPerOrderItem(item, expenseByProduct, isRefused = false, atDate = null) {
  const unit = itemUnit(item, expenseByProduct, atDate || item.order?.createdAt || null);
  const cogs = unit.cogs;
  const revenue = Number(item.price) * item.quantity;
  const cogsTotal = cogs * item.quantity;
  if (isRefused) return revenue - cogsTotal;
  const managerCostFixed = unit.fixed;
  const managerCostPercent = unit.percent;
  const markup = revenue - cogsTotal; // націнка, база для % менеджера — не вся виручка
  const managerCost = managerCostFixed * item.quantity + (markup * managerCostPercent) / 100;
  return revenue - cogsTotal - managerCost;
}

// Спільний WHERE-фрагмент "фактичний продаж" (не відмова на НП, без оформленого повернення) —
// 2026-09-12, аудит аналітики за проханням власника: різні §6-звіти й /product-expenses
// виключали Return/isRefused по-різному (десь жодне, десь лише одне з двох) — виручка й
// маржа на різних сторінках (Дашборд, Щоденна аналітика, Витрати по товару) рахувались із
// РІЗНИХ наборів замовлень і не збігались одне з одним. computeAdStats (routes/ads.js,
// сторінка «Рекламні витрати») вже робив це правильно — решта звітів приведені до того
// самого критерію.
//
// 2026-10-06: у таблиці Order лежать ДВА різні види записів. З 09.09 кожна розмова з воронки — це картка (funnelSessionId, товар
// із ціною, щойно бот показав картку товару), а замовленням вона стає лише коли є покупець (телефон, ПІБ). Без цього розрізнення
// «Аналітика» рахувала кожну презентацію як продаж: за 7 днів 4,71 млн грн виручки замість 307 тис. (3313 «замовлень» замість 179).
// Єдине визначення — тут; звіти беруть лише ці фрагменти:
//   ORDER_PLACED_WHERE   — оформлене замовлення (є покупець), включно з відмовами (знаменник «% відмов»);
//   REAL_SALE_ORDER_WHERE — фактичний продаж: оформлене, не відмова, без повернення, не скасоване;
//   LEAD_WHERE           — розмова з воронки (картка; стає замовленням у тому ж рядку) — «контакти/повідомлення» для CPL і конверсії.
// Видалені/скасовані менеджером (Order.deletedAt, 2026-11-06) не рахуються ніде: це одне місце, звідки його беруть усі звіти.
const ORDER_PLACED_WHERE = { buyerId: { not: null }, deletedAt: null };
const REAL_SALE_ORDER_WHERE = { ...ORDER_PLACED_WHERE, isRefused: false, returns: { none: {} } };
const LEAD_WHERE = { funnelSessionId: { not: null }, deletedAt: null };
// Дата замовлення в звітах (2026-10-26, Edits c4fc2dcd) — дата ОФОРМЛЕННЯ (placedAt); createdAt замовлення з розмови — початок розмови.
// Для карток розмов (LEAD_WHERE) лишається createdAt. placedAt заповнено для всіх замовлень (міграція 20261026010000).
const placedAtOf = (o) => (o && (o.placedAt || o.createdAt)) || null;

module.exports = { loadExpenseMap, marginPerOrderItem, cogsAt, itemUnit, itemPieces, REAL_SALE_ORDER_WHERE, ORDER_PLACED_WHERE, LEAD_WHERE, placedAtOf };
