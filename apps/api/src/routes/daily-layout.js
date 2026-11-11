// «Щоденна аналітика»: власні показники й шаблони розкладки (Edits bb8fe39f/26d9b146, 10.11). Формули рахує адмінка; тут — збереження.
const express = require('express');
const crypto = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { sanitizeLayout } = require('../lib/dailyLayout');

const router = express.Router();
const MAX_TEMPLATES = 30;

const templatesOf = (t) => (Array.isArray(t.dailyTemplates) ? t.dailyTemplates : []);

router.get('/analytics/daily-layout', asyncHandler(async (req, res) => {
  const t = await db.tenant.findUnique({ where: { id: req.tenant.id }, select: { dailyLayout: true, dailyTemplates: true } });
  res.json({ ok: true, data: { layout: t.dailyLayout || null, templates: templatesOf(t) } });
}));

// layout: null — повернути стандартну розкладку (власні показники зникають із таблиці; їхні ручні значення лишаються в базі).
router.put('/analytics/daily-layout', asyncHandler(async (req, res) => {
  const layout = sanitizeLayout(req.body ? req.body.layout : undefined);
  await db.tenant.update({ where: { id: req.tenant.id }, data: { dailyLayout: layout === null ? Prisma.DbNull : layout } });
  res.json({ ok: true, data: { layout } });
}));

router.post('/analytics/daily-templates', asyncHandler(async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  if (!name) throw new ValidationError('Вкажіть назву шаблону');
  const layout = sanitizeLayout(req.body.layout);
  if (!layout) throw new ValidationError('Немає розкладки для збереження');
  const t = await db.tenant.findUnique({ where: { id: req.tenant.id }, select: { dailyTemplates: true } });
  const list = templatesOf(t);
  if (list.length >= MAX_TEMPLATES) throw new ValidationError(`Забагато шаблонів (максимум ${MAX_TEMPLATES}), видаліть непотрібні`);
  const tpl = { id: 't_' + crypto.randomBytes(5).toString('hex'), name, layout, createdAt: new Date().toISOString() };
  await db.tenant.update({ where: { id: req.tenant.id }, data: { dailyTemplates: [...list, tpl] } });
  res.status(201).json({ ok: true, data: tpl });
}));

router.delete('/analytics/daily-templates/:id', asyncHandler(async (req, res) => {
  const t = await db.tenant.findUnique({ where: { id: req.tenant.id }, select: { dailyTemplates: true } });
  const list = templatesOf(t);
  if (!list.some((x) => x.id === req.params.id)) throw new NotFoundError('Template', req.params.id);
  await db.tenant.update({ where: { id: req.tenant.id }, data: { dailyTemplates: list.filter((x) => x.id !== req.params.id) } });
  res.json({ ok: true, data: { id: req.params.id, deleted: true } });
}));

// Ручне значення власного показника за день; value: null — прибрати (далі діє перенесене з попередніх днів).
router.put('/analytics/daily-custom-values', asyncHandler(async (req, res) => {
  const { rowId, date, value } = req.body || {};
  if (!/^c_[A-Za-z0-9_]{1,40}$/.test(String(rowId || ''))) throw new ValidationError('rowId: невірний показник');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new ValidationError('date: YYYY-MM-DD');
  const t = await db.tenant.findUnique({ where: { id: req.tenant.id }, select: { dailyLayout: true } });
  const row = t.dailyLayout && Array.isArray(t.dailyLayout.rows) ? t.dailyLayout.rows.find((r) => r.id === rowId && r.custom && r.custom.type === 'manual') : null;
  if (!row) throw new ValidationError('Такого показника з ручним введенням немає в розкладці');
  const day = new Date(date + 'T00:00:00Z');
  if (value === null || value === '' || value === undefined) {
    await db.dayCustomValue.deleteMany({ where: { tenantId: req.tenant.id, rowId, date: day } });
    return res.json({ ok: true, data: { rowId, date, value: null } });
  }
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new ValidationError('Значення має бути числом');
  await db.dayCustomValue.upsert({ where: { tenantId_rowId_date: { tenantId: req.tenant.id, rowId, date: day } }, create: { tenantId: req.tenant.id, rowId, date: day, value: n }, update: { value: n } });
  res.json({ ok: true, data: { rowId, date, value: n } });
}));

module.exports = router;
