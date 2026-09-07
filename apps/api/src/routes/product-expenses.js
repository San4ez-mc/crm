// §4.10/§9.15 ProductExpense — inline-редагування (autosave), маржа за спільною формулою
// з lib/margin.js (10% від НАЦІНКИ, не виручки; 0 за відмову — 2026-09-05), щоб цифри тут
// збігались з дашбордом аналітики, а не рахувались за старою (іншою) формулою вдруге.
// Алерт про від'ємну маржу (§9.15) — CRM лише віддає стан через /product-expenses/alerts;
// саму Telegram-нотифікацію (notifyTg-патерн) шле окрема Flows-автоматизація, що це опитує —
// CRM свідомо не тримає власних Telegram-креденшелів (ключі лишаються у funnelKey воронки).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { NotFoundError, ValidationError } = require('@crm/errors');
const { parseFrom, parseTo } = require('../lib/dateRange');
const { loadExpenseMap, marginPerOrderItem, cogsAt } = require('../lib/margin');
const { ensureFreshUsdRate, sumAdSpendUAH } = require('../lib/currency');

const router = express.Router();

async function adSpendForProduct(tenantId, productId, from, to, usdRate) {
  return sumAdSpendUAH({ ad: { tenantId, productId }, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) }, usdRate);
}

// ДОПОВНЕННЯ 2026-09-07 (фідбек власника): ціна постачальника змінюється в часі — приймаємо
// [{cost, validFrom}], сортуємо за зростанням validFrom, відкидаємо биті рядки.
function sanitizeCogsHistory(input) {
  if (!Array.isArray(input)) return undefined;
  return input
    .map((h) => ({ cost: Number(h?.cost) || 0, validFrom: String(h?.validFrom || '').slice(0, 10) }))
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.validFrom))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

router.get('/product-expenses', asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const fromDate = parseFrom(from);
  const toDate = parseTo(to);
  const tenant = await ensureFreshUsdRate(req.tenant);
  const usdRate = Number(tenant.usdExchangeRate || 0);

  const products = await db.product.findMany({
    where: { tenantId: req.tenant.id },
    include: {
      productExpense: true,
      orderItems: {
        where: { order: { ...(fromDate || toDate ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } } : {}) } },
        include: { order: { select: { createdAt: true, isRefused: true } } },
      },
    },
  });
  const expenseByProduct = await loadExpenseMap(req.tenant.id);

  const data = await Promise.all(products.map(async (p) => {
    const qty = p.orderItems.reduce((s, it) => s + it.quantity, 0);
    const revenue = p.orderItems.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
    const adSpend = await adSpendForProduct(req.tenant.id, p.id, fromDate, toDate, usdRate);
    const exp = p.productExpense;
    const marginBeforeAdSpend = p.orderItems.reduce((s, it) => s + marginPerOrderItem(it, expenseByProduct, it.order.isRefused, it.order.createdAt), 0);
    const margin = marginBeforeAdSpend - adSpend;
    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      cogs: cogsAt(exp, null), // поточна діюча ціна постачальника
      cogsHistory: Array.isArray(exp?.cogsHistory) ? exp.cogsHistory : [],
      managerCostFixed: Number(exp?.managerCostFixed || 0),
      managerCostPercent: Number(exp?.managerCostPercent || 0),
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
  const { cogs, managerCostFixed, managerCostPercent, cogsHistory } = req.body || {};
  const sanitizedHistory = sanitizeCogsHistory(cogsHistory);
  if (cogsHistory !== undefined && sanitizedHistory === undefined) throw new ValidationError('cogsHistory має бути масивом [{cost, validFrom}]');
  // Якщо прийшла історія — вона є джерелом істини, а флет cogs лише кешується з неї
  // (для місць, де дата не важлива); якщо історії нема — лишаємо старий шлях (простий cogs).
  const activeCogs = sanitizedHistory !== undefined ? cogsAt({ cogsHistory: sanitizedHistory }, null) : cogs;
  const expense = await db.productExpense.upsert({
    where: { productId: product.id },
    update: {
      ...(sanitizedHistory !== undefined ? { cogsHistory: sanitizedHistory, cogs: activeCogs } : (cogs !== undefined ? { cogs } : {})),
      ...(managerCostFixed !== undefined ? { managerCostFixed } : {}),
      ...(managerCostPercent !== undefined ? { managerCostPercent } : {}),
    },
    create: {
      tenantId: req.tenant.id,
      productId: product.id,
      cogs: activeCogs ?? 0,
      cogsHistory: sanitizedHistory ?? [],
      managerCostFixed: managerCostFixed ?? 0,
      managerCostPercent: managerCostPercent ?? 0,
    },
  });
  res.json({ ok: true, data: expense });
}));

// Стан для алерту «маржа стала від'ємною» — опитується Flows-автоматизацією (не сама CRM шле Telegram).
router.get('/product-expenses/alerts', asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const tenant = await ensureFreshUsdRate(req.tenant);
  const usdRate = Number(tenant.usdExchangeRate || 0);
  const products = await db.product.findMany({
    where: { tenantId: req.tenant.id },
    include: { productExpense: true, orderItems: { where: { order: { createdAt: { gte: since } } }, include: { order: { select: { createdAt: true, isRefused: true } } } } },
  });
  const expenseByProduct = await loadExpenseMap(req.tenant.id);
  const alerts = [];
  for (const p of products) {
    if (!p.productExpense) continue;
    const qty = p.orderItems.reduce((s, it) => s + it.quantity, 0);
    if (qty === 0) continue;
    const adSpend = await adSpendForProduct(req.tenant.id, p.id, since, null, usdRate);
    const marginBeforeAdSpend = p.orderItems.reduce((s, it) => s + marginPerOrderItem(it, expenseByProduct, it.order.isRefused, it.order.createdAt), 0);
    const margin = marginBeforeAdSpend - adSpend;
    if (margin < 0) alerts.push({ productId: p.id, name: p.name, sku: p.sku, margin, periodHours: 24 });
  }
  res.json({ ok: true, data: alerts });
}));

module.exports = router;
