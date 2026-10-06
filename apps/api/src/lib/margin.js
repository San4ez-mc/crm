// Спільна формула маржі по позиції замовлення — той самий підхід, що в
// /analytics/margin і /analytics/daily (apps/api/src/routes/analytics.js): дохід −
// собівартість − ЗП менеджера (fixed+percent). Винесено сюди 2026-09-03, щоб не
// дублювати в новому per-оголошення звіті (routes/ads.js).
const { db } = require('@crm/db');

async function loadExpenseMap(tenantId) {
  const rows = await db.productExpense.findMany({ where: { tenantId } });
  return new Map(rows.map((r) => [r.productId, r]));
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
  const exp = item.productId ? expenseByProduct.get(item.productId) : null;
  const cogs = cogsAt(exp, atDate || item.order?.createdAt || null);
  const revenue = Number(item.price) * item.quantity;
  const cogsTotal = cogs * item.quantity;
  if (isRefused) return revenue - cogsTotal;
  const managerCostFixed = Number(exp?.managerCostFixed || 0);
  const managerCostPercent = Number(exp?.managerCostPercent || 0);
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
//   REAL_SALE_ORDER_WHERE — фактичний продаж: оформлене, не відмова, без повернення;
//   LEAD_WHERE           — розмова з воронки (картка; стає замовленням у тому ж рядку) — «контакти/повідомлення» для CPL і конверсії.
const ORDER_PLACED_WHERE = { buyerId: { not: null } };
const REAL_SALE_ORDER_WHERE = { ...ORDER_PLACED_WHERE, isRefused: false, returns: { none: {} } };
const LEAD_WHERE = { funnelSessionId: { not: null } };

module.exports = { loadExpenseMap, marginPerOrderItem, cogsAt, REAL_SALE_ORDER_WHERE, ORDER_PLACED_WHERE, LEAD_WHERE };
