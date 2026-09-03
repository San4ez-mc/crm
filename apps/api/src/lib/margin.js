// Спільна формула маржі по позиції замовлення — той самий підхід, що в
// /analytics/margin і /analytics/daily (apps/api/src/routes/analytics.js): дохід −
// собівартість − ЗП менеджера (fixed+percent). Винесено сюди 2026-09-03, щоб не
// дублювати в новому per-оголошення звіті (routes/ads.js).
const { db } = require('@crm/db');

async function loadExpenseMap(tenantId) {
  const rows = await db.productExpense.findMany({ where: { tenantId } });
  return new Map(rows.map((r) => [r.productId, r]));
}

function marginPerOrderItem(item, expenseByProduct) {
  const exp = item.productId ? expenseByProduct.get(item.productId) : null;
  const cogs = Number(exp?.cogs || 0);
  const managerCostFixed = Number(exp?.managerCostFixed || 0);
  const managerCostPercent = Number(exp?.managerCostPercent || 0);
  const revenue = Number(item.price) * item.quantity;
  return revenue - cogs * item.quantity - managerCostFixed * item.quantity - (revenue * managerCostPercent) / 100;
}

module.exports = { loadExpenseMap, marginPerOrderItem };
