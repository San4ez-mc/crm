// ДОПОВНЕННЯ 2026-09-01 — Етапи воронки (аналітика конверсії). Джерело подій — нода
// "Етап воронки" (funnelStage) у FINEKO Flows, довільна на кожну воронку (не enum).
// POST /funnel-events — приймає подію від Flows (Bearer tenant.apiKey, best-effort зі
// сторони воронки). GET /funnel-events/summary — агрегація для графіка-воронки в CRM:
// кількість УНІКАЛЬНИХ сесій на кожному етапі + конверсія від попереднього.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('@crm/errors');
const { parseFrom, parseTo } = require('../lib/dateRange');

const router = express.Router();

// Стадія pipeline за назвою етапу (стадії названі як етапи воронки) — без урахування регістру.
async function stageByName(tenantId, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!want) return null;
  const pipelines = await db.pipeline.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' }, include: { stages: true } });
  for (const p of pipelines) { const hit = p.stages.find((s) => String(s.name || '').trim().toLowerCase() === want); if (hit) return hit; }
  return null;
}

// 2026-09-09 (власник: «всіх перенеси в замовлення»): кожна подія воронки = картка на дошці замовлень.
// Перша подія створює картку (contactName/contactIg, позиція = презентований товар), наступні рухають її по
// стадіях і оновлюють lastClientAt. Реальне замовлення (POST /orders з funnelSessionId) доповнює цю ж картку.
async function upsertFunnelCard(tenantId, { sessionId, stageName, funnelSlug, igUsername, senderName, product, lastClientAt }) {
  const stage = await stageByName(tenantId, stageName);
  const existing = await db.order.findFirst({ where: { tenantId, funnelSessionId: String(sessionId) }, include: { items: { select: { id: true } } } });
  const contact = { ...(senderName ? { contactName: String(senderName).slice(0, 120) } : {}), ...(igUsername ? { contactIg: String(igUsername).slice(0, 120) } : {}) };
  const item = product && (product.name || product.sku) ? { productId: product.id || null, name: String(product.name || product.sku), price: Number(product.price) || 0, quantity: 1, properties: product.sku ? [{ name: 'Артикул', value: String(product.sku) }] : null, isUpsell: false } : null;
  const at = lastClientAt && !Number.isNaN(new Date(lastClientAt).getTime()) ? new Date(lastClientAt) : new Date(); // бекфіл передає реальний час останньої активності
  if (!existing) {
    return db.order.create({ data: { tenantId, funnelSessionId: String(sessionId), stageId: stage ? stage.id : undefined, sourceName: 'Instagram' + (funnelSlug ? ' ' + String(funnelSlug) : ''), lastClientAt: at, ...contact, ...(item ? { items: { create: [item] } } : {}) } });
  }
  return db.order.update({ where: { id: existing.id }, data: { ...(stage ? { stageId: stage.id } : {}), lastClientAt: at, ...contact, ...(item && !existing.items.length ? { items: { create: [item] } } : {}) } });
}

router.post('/funnel-events', asyncHandler(async (req, res) => {
  const { funnelSlug, sessionId, stageName, stageOrder, igUsername, senderName, product, lastClientAt } = req.body || {};
  if (!sessionId || !stageName) throw new ValidationError('sessionId і stageName обовʼязкові');
  const row = await db.funnelEvent.upsert({
    where: { tenantId_sessionId_stageName: { tenantId: req.tenant.id, sessionId: String(sessionId), stageName: String(stageName) } },
    update: { occurredAt: new Date(), stageOrder: Number(stageOrder) || 0, ...(funnelSlug ? { funnelSlug: String(funnelSlug) } : {}) },
    create: { tenantId: req.tenant.id, funnelSlug: funnelSlug ? String(funnelSlug) : null, sessionId: String(sessionId), stageName: String(stageName), stageOrder: Number(stageOrder) || 0 },
  });
  let card = null;
  try { card = await upsertFunnelCard(req.tenant.id, { sessionId, stageName, funnelSlug, igUsername, senderName, product, lastClientAt }); }
  catch (e) { /* картка на дошці — best-effort, аналітика подій важливіша */ }
  res.status(201).json({ ok: true, data: row, orderId: card ? card.id : null });
}));

// §9 Дашборд «Воронка» — по кожному етапу: унікальних сесій, % конверсії від попереднього
// етапу і % від самого першого. Сортування — за stageOrder (задає автор ноди у Flows).
router.get('/funnel-events/summary', asyncHandler(async (req, res) => {
  const { funnelSlug, from, to } = req.query;
  const where = {
    tenantId: req.tenant.id,
    ...(funnelSlug ? { funnelSlug: String(funnelSlug) } : {}),
    ...(from || to ? { occurredAt: { ...(from ? { gte: parseFrom(from) } : {}), ...(to ? { lte: parseTo(to) } : {}) } } : {}),
  };
  const grouped = await db.funnelEvent.groupBy({
    by: ['stageName', 'stageOrder'],
    where,
    _count: { _all: true },
    orderBy: { stageOrder: 'asc' },
  });
  const first = grouped[0]?._count._all || 0;
  let prev = null;
  const stages = grouped.map((g) => {
    const count = g._count._all;
    const convFromPrev = prev !== null && prev > 0 ? Math.round((count / prev) * 1000) / 10 : null;
    const convFromFirst = first > 0 ? Math.round((count / first) * 1000) / 10 : null;
    prev = count;
    return { stageName: g.stageName, stageOrder: g.stageOrder, sessions: count, convFromPrev, convFromFirst };
  });
  res.json({ ok: true, data: stages });
}));

// "Застрягли" — сесії, які дійшли до якогось етапу, але вже давно (thresholdHours, дефолт 48г)
// не просунулись далі і не дійшли до фінального етапу воронки. Рахуємо в JS (не groupBy),
// бо треба саме ОСТАННІЙ (максимальний stageOrder) етап на сесію — Prisma groupBy так не вміє.
router.get('/funnel-events/stuck', asyncHandler(async (req, res) => {
  const { funnelSlug, thresholdHours } = req.query;
  const threshold = Number(thresholdHours) || 48;
  const cutoff = new Date(Date.now() - threshold * 3600 * 1000);
  const rows = await db.funnelEvent.findMany({
    where: { tenantId: req.tenant.id, ...(funnelSlug ? { funnelSlug: String(funnelSlug) } : {}) },
    select: { sessionId: true, stageName: true, stageOrder: true, occurredAt: true },
  });
  if (!rows.length) return void res.json({ ok: true, data: { stuckByStage: [], totalStuck: 0, thresholdHours: threshold } });

  const finalStageOrder = Math.max(...rows.map((r) => r.stageOrder));
  const lastEventBySession = new Map();
  for (const r of rows) {
    const cur = lastEventBySession.get(r.sessionId);
    if (!cur || r.stageOrder > cur.stageOrder) lastEventBySession.set(r.sessionId, r);
  }

  const stuckByStage = new Map();
  let totalStuck = 0;
  for (const s of lastEventBySession.values()) {
    if (s.stageOrder < finalStageOrder && s.occurredAt < cutoff) {
      totalStuck += 1;
      const row = stuckByStage.get(s.stageName) || { stageName: s.stageName, stageOrder: s.stageOrder, count: 0 };
      row.count += 1;
      stuckByStage.set(s.stageName, row);
    }
  }
  res.json({ ok: true, data: { stuckByStage: [...stuckByStage.values()].sort((a, b) => a.stageOrder - b.stageOrder), totalStuck, thresholdHours: threshold } });
}));

// Список воронок (funnelSlug), для яких взагалі є події — щоб наповнити фільтр на сторінці.
router.get('/funnel-events/funnels', asyncHandler(async (req, res) => {
  const rows = await db.funnelEvent.findMany({ where: { tenantId: req.tenant.id }, select: { funnelSlug: true }, distinct: ['funnelSlug'] });
  res.json({ ok: true, data: rows.map((r) => r.funnelSlug).filter(Boolean) });
}));

module.exports = router;
