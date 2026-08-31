// §9.16 Налаштування — Загальні: назва магазину, API-ключ (показати/перегенерувати).
// Працює в межах req.tenant, встановленого resolveTenant — без окремого :id в шляху.
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('@crm/errors');

const router = express.Router();

router.get('/tenant', asyncHandler(async (req, res) => {
  const t = req.tenant;
  res.json({
    ok: true,
    data: {
      id: t.id, name: t.name, apiKey: t.apiKey, ssoOrgId: t.ssoOrgId, novaPoshtaApiKey: t.novaPoshtaApiKey,
      usdExchangeRate: t.usdExchangeRate, dailyFixedCosts: t.dailyFixedCosts, dailyPayrollCosts: t.dailyPayrollCosts,
    },
  });
}));

router.patch('/tenant', asyncHandler(async (req, res) => {
  const { name, novaPoshtaApiKey, usdExchangeRate, dailyFixedCosts, dailyPayrollCosts } = req.body || {};
  if (name !== undefined && !String(name).trim()) throw new ValidationError('name не може бути порожнім');
  const tenant = await db.tenant.update({
    where: { id: req.tenant.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(novaPoshtaApiKey !== undefined ? { novaPoshtaApiKey } : {}),
      ...(usdExchangeRate !== undefined ? { usdExchangeRate } : {}),
      ...(dailyFixedCosts !== undefined ? { dailyFixedCosts } : {}),
      ...(dailyPayrollCosts !== undefined ? { dailyPayrollCosts } : {}),
    },
  });
  res.json({
    ok: true,
    data: {
      id: tenant.id, name: tenant.name, novaPoshtaApiKey: tenant.novaPoshtaApiKey,
      usdExchangeRate: tenant.usdExchangeRate, dailyFixedCosts: tenant.dailyFixedCosts, dailyPayrollCosts: tenant.dailyPayrollCosts,
    },
  });
}));

// §9.17 — зведення по підключених рекламних кабінетах (сама інтеграція з Zernio живе у Flows,
// CRM лише показує стан того, що вже прийшло через write-API /ad-spend-daily).
router.get('/integrations/zernio-status', asyncHandler(async (req, res) => {
  const ads = await db.ad.findMany({ where: { tenantId: req.tenant.id, externalId: { not: null } }, select: { id: true, externalId: true, name: true } });
  const latestByAd = await db.adSpendDaily.groupBy({ by: ['adId'], where: { adId: { in: ads.map((a) => a.id) } }, _max: { date: true } });
  const lastSyncByAd = new Map(latestByAd.map((r) => [r.adId, r._max.date]));
  res.json({ ok: true, data: ads.map((a) => ({ ...a, lastSyncedAt: lastSyncByAd.get(a.id) || null })) });
}));

// Перегенерація — стару воронку/MCP-конектор доведеться оновити новим ключем (попередження в UI).
router.post('/tenant/regenerate-key', asyncHandler(async (req, res) => {
  const tenant = await db.tenant.update({ where: { id: req.tenant.id }, data: { apiKey: crypto.randomUUID() } });
  res.json({ ok: true, data: { id: tenant.id, apiKey: tenant.apiKey } });
}));

module.exports = router;
