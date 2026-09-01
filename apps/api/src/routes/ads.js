// §4.9 Ad / AdSpendDaily / AdClick + §9.13 Рекламні витрати.
// POST /ad-spend-daily і /ad-clicks — write-ендпойнти для окремої crontab-воронки FINEKO Flows,
// яка ходить у Zernio/Meta Ads API (§2, §5 ТЗ) — той самий Bearer tenant.apiKey.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { parseFrom, parseTo } = require('../lib/dateRange');

const router = express.Router();

router.get('/ads', asyncHandler(async (req, res) => {
  const { productId, take = '100', skip = '0' } = req.query;
  const where = { tenantId: req.tenant.id, ...(productId ? { productId: String(productId) } : {}) };
  const ads = await db.ad.findMany({
    where,
    include: { product: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: Number(take),
    skip: Number(skip),
  });
  res.json({ ok: true, data: ads });
}));

router.post('/ads', asyncHandler(async (req, res) => {
  const { externalId, name, productId, campaignId, campaignName, adAccountId } = req.body || {};
  const ad = await db.ad.create({
    data: {
      tenantId: req.tenant.id, externalId: externalId || null, name: name || null, productId: productId || null,
      campaignId: campaignId || null, campaignName: campaignName || null, adAccountId: adAccountId || null,
    },
  });
  res.status(201).json({ ok: true, data: ad });
}));

// Прив'язка оголошення до товару — inline-редагування в §9.13 (рядки без товару підсвічені).
router.patch('/ads/:id', asyncHandler(async (req, res) => {
  const existing = await db.ad.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Ad', req.params.id);
  const { productId, name } = req.body || {};
  const ad = await db.ad.update({
    where: { id: existing.id },
    data: { ...(productId !== undefined ? { productId: productId || null } : {}), ...(name !== undefined ? { name } : {}) },
  });
  res.json({ ok: true, data: ad });
}));

// §9.13 таблиця дата×кабінет/оголошення×товар×сума — з agregацією по AdSpendDaily.
router.get('/ad-spend', asyncHandler(async (req, res) => {
  const { from, to, productId, take = '200', skip = '0' } = req.query;
  const where = {
    ad: { tenantId: req.tenant.id, ...(productId ? { productId: String(productId) } : {}) },
    ...(from || to ? { date: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    db.adSpendDaily.findMany({ where, include: { ad: { include: { product: { select: { id: true, name: true } } } } }, orderBy: { date: 'desc' }, take: Number(take), skip: Number(skip) }),
    db.adSpendDaily.count({ where }),
  ]);
  res.json({ ok: true, data: items, meta: { total, take: Number(take), skip: Number(skip) } });
}));

// ДОПОВНЕННЯ 2026-09-01 — кнопка "Отримати дані зараз" на сторінці реклами: тригерить
// відповідну cron-воронку Flows (Meta Ads Sync) прямо зараз, не чекаючи щоденний крон.
// botId per-tenant зберігається як TenantSecret FLOWS_META_SYNC_BOT_ID (заповнюється вручну
// один раз при підключенні магазину). FLOWS_API_URL/FLOWS_API_SECRET — системні, у .env,
// той самий X-Api-Secret механізм, яким платформа Flows сама себе авторизує служебно.
router.post('/ad-spend/sync-now', asyncHandler(async (req, res) => {
  const secret = await db.tenantSecret.findFirst({ where: { tenantId: req.tenant.id, key: 'FLOWS_META_SYNC_BOT_ID' } });
  if (!secret?.value) throw new ValidationError('Не налаштовано FLOWS_META_SYNC_BOT_ID для цього магазину (Ключі API)');
  if (!process.env.FLOWS_API_URL || !process.env.FLOWS_API_SECRET) throw new ValidationError('FLOWS_API_URL/FLOWS_API_SECRET не налаштовані на сервері CRM');

  const resp = await fetch(`${process.env.FLOWS_API_URL}/api/sessions/test/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Secret': process.env.FLOWS_API_SECRET },
    body: JSON.stringify({ botId: secret.value }),
  });
  const json = await resp.json().catch(() => null);
  if (!resp.ok || !json?.ok) throw new ValidationError('Flows не відповів успіхом: ' + (json?.error?.message || json?.error || resp.status));

  const snap = json.data?.contextSnapshot || {};
  res.json({ ok: true, data: { status: snap.metaSyncStatus || 'unknown', date: snap.metaSyncDate || null, adsCount: snap.metaSyncAdsCount ?? null, written: snap.metaSyncWritten ?? null, error: snap.metaSyncError || null } });
}));

async function findOrCreateAdByExternalId(tenantId, externalId, name, meta = {}) {
  let ad = await db.ad.findFirst({ where: { tenantId, externalId } });
  if (!ad) {
    ad = await db.ad.create({
      data: { tenantId, externalId, name: name || null, campaignId: meta.campaignId || null, campaignName: meta.campaignName || null, adAccountId: meta.adAccountId || null },
    });
  } else if (meta.campaignName || meta.campaignId || meta.adAccountId) {
    // Meta не міняє campaignId/adAccountId заднім числом, але назва кампанії могла оновитись.
    ad = await db.ad.update({
      where: { id: ad.id },
      data: { ...(meta.campaignId ? { campaignId: meta.campaignId } : {}), ...(meta.campaignName ? { campaignName: meta.campaignName } : {}), ...(meta.adAccountId ? { adAccountId: meta.adAccountId } : {}) },
    });
  }
  return ad;
}

// §5: `POST /ad-spend-daily` — щоденні витрати від Flows-автоматизації (Zernio/Meta Ads).
// impressions/clicks — платформні метрики самого Facebook (для CPC/CTR/CPM), не наш AdClick.
router.post('/ad-spend-daily', asyncHandler(async (req, res) => {
  const { externalId, adId, name, date, amount, currency, impressions, clicks, campaignId, campaignName, adAccountId } = req.body || {};
  if (!date || amount === undefined) throw new ValidationError('date і amount обовʼязкові');
  const ad = adId
    ? await db.ad.findFirst({ where: { id: adId, tenantId: req.tenant.id } })
    : await findOrCreateAdByExternalId(req.tenant.id, String(externalId || 'unknown'), name, { campaignId, campaignName, adAccountId });
  if (!ad) throw new NotFoundError('Ad', adId);
  const row = await db.adSpendDaily.upsert({
    where: { adId_date: { adId: ad.id, date: new Date(date) } },
    update: { amount, currency: currency || 'UAH', ...(impressions !== undefined ? { impressions: Number(impressions) } : {}), ...(clicks !== undefined ? { clicks: Number(clicks) } : {}) },
    create: { adId: ad.id, date: new Date(date), amount, currency: currency || 'UAH', impressions: impressions !== undefined ? Number(impressions) : null, clicks: clicks !== undefined ? Number(clicks) : null },
  });
  res.status(201).json({ ok: true, data: row });
}));

// §5: `POST /ad-clicks` — подія кліку, перше повідомлення нової сесії воронки з entryAd.
router.post('/ad-clicks', asyncHandler(async (req, res) => {
  const { externalId, adId, name, sessionId, timestamp } = req.body || {};
  const ad = adId
    ? await db.ad.findFirst({ where: { id: adId, tenantId: req.tenant.id } })
    : await findOrCreateAdByExternalId(req.tenant.id, String(externalId || 'unknown'), name);
  if (!ad) throw new NotFoundError('Ad', adId);
  const click = await db.adClick.create({ data: { adId: ad.id, sessionId: sessionId || null, timestamp: timestamp ? new Date(timestamp) : undefined } });
  res.status(201).json({ ok: true, data: click });
}));

module.exports = router;
