// Рядок «Без привʼязки до товару» для звітів по товарах (аудит 09.11): позиції замовлень без товару каталогу і реклама, не привʼязана до
// товару, раніше входили в «Щоденну» та «Менеджерів», але зникали зі звітів по товарах — суми двох сторінок не сходились (жовтень: 690 грн
// виручки і 12 950 грн реклами). Тепер вони окремим рядком, тож Σ по товарах = Σ по днях.
const { db } = require('@crm/db');
const { REAL_SALE_ORDER_WHERE, marginPerOrderItem, itemUnit, placedAtOf } = require('./margin');
const { sumAdSpendUAH } = require('./currency');
const { dayRange } = require('./dateRange');

/**
 * placedWhereObj — {placedAt:{gte,lte}} або {}; adRange — {gte,lte} (parseFrom/parseTo) або null;
 * adSpendByProduct — Map(productId → грн) з adSpendUAHByProduct (щоб відняти вже розподілену рекламу).
 */
async function unlinkedRow(tenantId, { placedWhereObj = {}, adRange = null, usdRate = 0, expenseByProduct, adSpendByProduct }) {
  const items = await db.orderItem.findMany({
    where: { productId: null, order: { tenantId, ...REAL_SALE_ORDER_WHERE, ...placedWhereObj } },
    include: { order: { select: { isRefused: true, createdAt: true, placedAt: true } } },
  });
  let qty = 0; let revenue = 0; let cogs = 0; let marginBefore = 0;
  for (const it of items) {
    const at = placedAtOf(it.order);
    qty += it.quantity; revenue += Number(it.price) * it.quantity;
    cogs += itemUnit(it, expenseByProduct, at).cogs * it.quantity;
    marginBefore += marginPerOrderItem(it, expenseByProduct, it.order.isRefused, at);
  }
  const totalAd = await sumAdSpendUAH({ ad: { tenantId }, ...(adRange ? { date: dayRange(adRange) } : {}) }, usdRate);
  const linkedAd = [...adSpendByProduct.values()].reduce((s, v) => s + v, 0);
  const adSpend = Math.max(0, totalAd - linkedAd);
  if (!items.length && adSpend < 1) return null;
  const margin = marginBefore - adSpend;
  return {
    productId: '__unlinked', name: 'Без привʼязки до товару (реклама без товару)', sku: null, isUnlinked: true,
    revenue, qty, adSpend, cogs, managerCost: revenue - cogs - marginBefore, margin, marginPercent: revenue > 0 ? (margin / revenue) * 100 : null,
  };
}

module.exports = { unlinkedRow };
