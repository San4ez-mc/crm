// §9.16 Налаштування — Загальні: назва магазину, API-ключ (показати/перегенерувати).
// Працює в межах req.tenant, встановленого resolveTenant — без окремого :id в шляху.
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('@crm/errors');
const { ensureFreshUsdRate, fetchUsdToUahFromNbu } = require('../lib/currency');
const { normalizeFitChart, normalizeSizeRules } = require('../lib/sizeFit');

const router = express.Router();

router.get('/tenant', asyncHandler(async (req, res) => {
  // best-effort — якщо курс застарів (>12 год), підтягуємо свіжий з НБУ просто при відкритті сторінки.
  const t = await ensureFreshUsdRate(req.tenant);
  res.json({
    ok: true,
    data: {
      id: t.id, name: t.name, apiKey: t.apiKey, ssoOrgId: t.ssoOrgId, novaPoshtaApiKey: t.novaPoshtaApiKey,
      usdExchangeRate: t.usdExchangeRate, usdExchangeRateUpdatedAt: t.usdExchangeRateUpdatedAt,
      dailyFixedCosts: t.dailyFixedCosts, dailyPayrollCosts: t.dailyPayrollCosts,
      fitChart: t.fitChart || null, sizeRules: Array.isArray(t.sizeRules) ? t.sizeRules : [],
      shopDescription: t.shopDescription || '', prepaymentAmount: t.prepaymentAmount, shippingTerms: t.shippingTerms || '',
    },
  });
}));

// Умови й тип магазину — для бота (Flows): що він каже клієнту про передоплату й відправку, ким себе вважає в промптах.
router.get('/tenant/shop-profile', asyncHandler(async (req, res) => {
  const t = await db.tenant.findUnique({ where: { id: req.tenant.id }, select: { name: true, shopDescription: true, prepaymentAmount: true, shippingTerms: true } });
  res.json({ ok: true, data: { name: t.name, shopDescription: t.shopDescription || '', prepaymentAmount: t.prepaymentAmount != null ? Number(t.prepaymentAmount) : null, shippingTerms: t.shippingTerms || '' } });
}));

// Загальна сітка розмірів магазину — для бота (Flows productMatch): лише два поля, без побічних дій GET /tenant (курс НБУ).
router.get('/tenant/size-fit', asyncHandler(async (req, res) => {
  const t = await db.tenant.findUnique({ where: { id: req.tenant.id }, select: { fitChart: true, sizeRules: true } });
  res.json({ ok: true, data: { fitChart: (t && t.fitChart) || null, sizeRules: t && Array.isArray(t.sizeRules) ? t.sizeRules : [] } });
}));

router.patch('/tenant', asyncHandler(async (req, res) => {
  const { name, novaPoshtaApiKey, usdExchangeRate, dailyFixedCosts, dailyPayrollCosts, fitChart, sizeRules, shopDescription, prepaymentAmount, shippingTerms } = req.body || {};
  if (prepaymentAmount !== undefined && prepaymentAmount !== null && prepaymentAmount !== '' && !(Number(prepaymentAmount) > 0)) throw new ValidationError('Передоплата має бути більшою за 0');
  if (name !== undefined && !String(name).trim()) throw new ValidationError('name не може бути порожнім');
  const tenant = await db.tenant.update({
    where: { id: req.tenant.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(novaPoshtaApiKey !== undefined ? { novaPoshtaApiKey } : {}),
      // ручний ввід курсу — власник може перезаписати автоматичний, позначаємо часом збереження,
      // щоб ensureFreshUsdRate не перетер його одразу знову (12-год "застарілість" рахується звідси).
      ...(usdExchangeRate !== undefined ? { usdExchangeRate, usdExchangeRateUpdatedAt: new Date() } : {}),
      ...(dailyFixedCosts !== undefined ? { dailyFixedCosts } : {}),
      ...(dailyPayrollCosts !== undefined ? { dailyPayrollCosts } : {}),
      ...(fitChart !== undefined ? { fitChart: normalizeFitChart(fitChart) } : {}),
      ...(sizeRules !== undefined ? { sizeRules: normalizeSizeRules(sizeRules) } : {}),
      ...(shopDescription !== undefined ? { shopDescription: String(shopDescription || '').trim() || null } : {}),
      ...(prepaymentAmount !== undefined ? { prepaymentAmount: prepaymentAmount === null || prepaymentAmount === '' ? null : Number(prepaymentAmount) } : {}),
      ...(shippingTerms !== undefined ? { shippingTerms: String(shippingTerms || '').trim() || null } : {}),
    },
  });
  res.json({
    ok: true,
    data: {
      id: tenant.id, name: tenant.name, novaPoshtaApiKey: tenant.novaPoshtaApiKey,
      usdExchangeRate: tenant.usdExchangeRate, usdExchangeRateUpdatedAt: tenant.usdExchangeRateUpdatedAt,
      dailyFixedCosts: tenant.dailyFixedCosts, dailyPayrollCosts: tenant.dailyPayrollCosts,
      fitChart: tenant.fitChart || null, sizeRules: Array.isArray(tenant.sizeRules) ? tenant.sizeRules : [],
      shopDescription: tenant.shopDescription || '', prepaymentAmount: tenant.prepaymentAmount, shippingTerms: tenant.shippingTerms || '',
    },
  });
}));

// Кнопка "Оновити курс" у Налаштуваннях — примусово (ігноруючи 12-год кеш) тягне свіжий
// курс з НБУ. На відміну від ensureFreshUsdRate (best-effort, тихо ковтає помилку) — тут
// помилку НБУ явно показуємо власнику, він сам натиснув кнопку і чекає на результат.
router.post('/tenant/refresh-exchange-rate', asyncHandler(async (req, res) => {
  const rate = await fetchUsdToUahFromNbu();
  const tenant = await db.tenant.update({ where: { id: req.tenant.id }, data: { usdExchangeRate: rate, usdExchangeRateUpdatedAt: new Date() } });
  res.json({ ok: true, data: { usdExchangeRate: tenant.usdExchangeRate, usdExchangeRateUpdatedAt: tenant.usdExchangeRateUpdatedAt } });
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
