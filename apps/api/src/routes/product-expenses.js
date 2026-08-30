// §4.10/§9.15 ProductExpense — inline-редагування (autosave), маржа за формулою:
//   маржа = дохід − cogs*qty − adSpend(період) − managerCostFixed*qty − дохід*managerCostPercent/100
// Алерт про від'ємну маржу (§9.15) — CRM лише віддає стан через /product-expenses/alerts;
// саму Telegram-нотифікацію (notifyTg-патерн) шле окрема Flows-автоматизація, що це опитує —
// CRM свідомо не тримає власних Telegram-креденшелів (ключі лишаються у funnelKey воронки).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { NotFoundError } = require('@crm/errors');
const { parseFrom, parseTo } = require('../lib/dateRange');

const router = express.Router();

async function adSpendForProduct(tenantId, productId, from, to) {
  const agg = await db.adSpendDaily.aggregate({
    where: {
      ad: { tenantId, productId },
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount || 0);
}

router.get('/product-expenses', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const fromDate = parseFrom(from);
  const toDate = parseTo(to);

  const products = await db.product.findMany({
    where: { tenantId: req.tenant.id },
    include: { productExpense: true, orderItems: { where: { order: { ...(fromDate || toDate ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) } } } },
  });

  const data = await Promise.all(products.map(async (p) => {
    const qty = p.orderItems.reduce((s, it) => s + it.quantity, 0);
    const revenue = p.orderItems.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
    const adSpend = await adSpendForProduct(req.tenant.id, p.id, fromDate, toDate);
    const cogs = Number(p.productExpense?.cogs || 0);
    const managerCostFixed = Number(p.productExpense?.managerCostFixed || 0);
    const managerCostPercent = Number(p.productExpense?.managerCostPercent || 0);
    const margin = revenue - cogs * qty - adSpend - managerCostFixed * qty - (revenue * managerCostPercent) / 100;
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      cogs,
      managerCostFixed,
      managerCostPercent,
      adSpend,
      qty,
      revenue,
      margin,
      marginPercent: revenue > 0 ? (margin / revenue) * 100 : null,
    };
  }));

  res.json({ ok: true, data });
}));

router.put('/product-expenses/:productId', asyncHandler(async (req, res) => {
  const product = await db.product.findFirst({ where: { id: req.params.productId, tenantId: req.tenant.id } });
  if (!product) throw new NotFoundError('Product', req.params.productId);
  const { cogs, managerCostFixed, managerCostPercent } = req.body || {};
  const expense = await db.productExpense.upsert({
    where: { productId: product.id },
    update: {
      ...(cogs !== undefined ? { cogs } : {}),
      ...(managerCostFixed !== undefined ? { managerCostFixed } : {}),
      ...(managerCostPercent !== undefined ? { managerCostPercent } : {}),
    },
    create: {
      tenantId: req.tenant.id,
      productId: product.id,
      cogs: cogs ?? 0,
      managerCostFixed: managerCostFixed ?? 0,
      managerCostPercent: managerCostPercent ?? 0,
    },
  });
  res.json({ ok: true, data: expense });
}));

// Стан для алерту «маржа стала від'ємною» — опитується Flows-автоматизацією (не сама CRM шле Telegram).
router.get('/product-expenses/alerts', asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const products = await db.product.findMany({ where: { tenantId: req.tenant.id }, include: { productExpense: true, orderItems: { where: { order: { createdAt: { gte: since } } } } } });
  const alerts = [];
  for (const p of products) {
    if (!p.productExpense) continue;
    const qty = p.orderItems.reduce((s, it) => s + it.quantity, 0);
    if (qty === 0) continue;
    const revenue = p.orderItems.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
    const adSpend = await adSpendForProduct(req.tenant.id, p.id, since, null);
    const { cogs, managerCostFixed, managerCostPercent } = p.productExpense;
    const margin = revenue - Number(cogs) * qty - adSpend - Number(managerCostFixed) * qty - (revenue * Number(managerCostPercent)) / 100;
    if (margin < 0) alerts.push({ productId: p.id, name: p.name, sku: p.sku, margin, periodHours: 24 });
  }
  res.json({ ok: true, data: alerts });
}));

module.exports = router;
