// Спільна формула маржі по позиції замовлення — той самий підхід, що в
// /analytics/margin і /analytics/daily (apps/api/src/routes/analytics.js): дохід −
// собівартість − ЗП менеджера (fixed+percent). Винесено сюди 2026-09-03, щоб не
// дублювати в новому per-оголошення звіті (routes/ads.js).
const { db } = require('@crm/db');

async function loadExpenseMap(tenantId) {
  const rows = await db.productExpense.findMany({ where: { tenantId } });
  return new Map(rows.map((r) => [r.productId, r]));
}

// 2026-09-05 (правило власника): ЗП менеджера — 10% (managerCostPercent) від НАЦІНКИ
// (виручка − собівартість), НЕ від усієї виручки як було раніше; і 0 повністю (і fixed,
// і percent), якщо замовлення відмовлене на Новій Пошті — менеджер за відмову не отримує
// нічого. COGS/виручка при цьому НЕ зануляються — питання "хто платить за зворотну
// доставку" ще не узгоджене (див. коментар при Order.isRefused), тут лише ЗП менеджера.
function marginPerOrderItem(item, expenseByProduct, isRefused = false) {
  const exp = item.productId ? expenseByProduct.get(item.productId) : null;
  const cogs = Number(exp?.cogs || 0);
  const revenue = Number(item.price) * item.quantity;
  const cogsTotal = cogs * item.quantity;
  if (isRefused) return revenue - cogsTotal;
  const managerCostFixed = Number(exp?.managerCostFixed || 0);
  const managerCostPercent = Number(exp?.managerCostPercent || 0);
  const markup = revenue - cogsTotal; // націнка, база для % менеджера — не вся виручка
  const managerCost = managerCostFixed * item.quantity + (markup * managerCostPercent) / 100;
  return revenue - cogsTotal - managerCost;
}

module.exports = { loadExpenseMap, marginPerOrderItem };
