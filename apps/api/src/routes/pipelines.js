// §4.7 Pipeline / Stage — редагується через MCP або сторінку «Воронки» (§9.6).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError, ConflictError } = require('@crm/errors');

const router = express.Router();

router.get('/pipelines', asyncHandler(async (req, res) => {
  const pipelines = await db.pipeline.findMany({
    where: { tenantId: req.tenant.id },
    include: { stages: { orderBy: { order: 'asc' }, include: { _count: { select: { orders: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({
    ok: true,
    data: pipelines.map((p) => ({
      ...p,
      stages: p.stages.map((s) => ({ ...s, ordersCount: s._count.orders, _count: undefined })),
    })),
  });
}));

router.post('/pipelines', asyncHandler(async (req, res) => {
  const { name, stages } = req.body || {};
  if (!name || !String(name).trim()) throw new ValidationError('name обовʼязкове');
  const pipeline = await db.pipeline.create({
    data: {
      tenantId: req.tenant.id,
      name: String(name).trim(),
      stages: { create: (Array.isArray(stages) && stages.length ? stages : [{ name: 'Новий' }]).map((s, i) => ({ name: s.name || s, order: i })) },
    },
    include: { stages: { orderBy: { order: 'asc' } } },
  });
  res.status(201).json({ ok: true, data: pipeline });
}));

router.patch('/pipelines/:id', asyncHandler(async (req, res) => {
  const existing = await db.pipeline.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Pipeline', req.params.id);
  const { name } = req.body || {};
  if (name !== undefined && !String(name).trim()) throw new ValidationError('name не може бути порожнім');
  const pipeline = await db.pipeline.update({
    where: { id: existing.id },
    data: { ...(name !== undefined ? { name: String(name).trim() } : {}) },
  });
  res.json({ ok: true, data: pipeline });
}));

// ── Stage ────────────────────────────────────────────────────────────────
router.post('/pipelines/:pipelineId/stages', asyncHandler(async (req, res) => {
  const pipeline = await db.pipeline.findFirst({ where: { id: req.params.pipelineId, tenantId: req.tenant.id } });
  if (!pipeline) throw new NotFoundError('Pipeline', req.params.pipelineId);
  const { name } = req.body || {};
  if (!name || !String(name).trim()) throw new ValidationError('name обовʼязкове');
  const maxOrder = await db.stage.aggregate({ where: { pipelineId: pipeline.id }, _max: { order: true } });
  const stage = await db.stage.create({ data: { pipelineId: pipeline.id, name: String(name).trim(), order: (maxOrder._max.order ?? -1) + 1 } });
  res.status(201).json({ ok: true, data: stage });
}));

router.patch('/stages/:id', asyncHandler(async (req, res) => {
  const existing = await db.stage.findFirst({ where: { id: req.params.id, pipeline: { tenantId: req.tenant.id } } });
  if (!existing) throw new NotFoundError('Stage', req.params.id);
  const { name, order } = req.body || {};
  const stage = await db.stage.update({
    where: { id: existing.id },
    data: { ...(name !== undefined ? { name: String(name).trim() } : {}), ...(order !== undefined ? { order: Number(order) } : {}) },
  });
  res.json({ ok: true, data: stage });
}));

router.delete('/stages/:id', asyncHandler(async (req, res) => {
  const existing = await db.stage.findFirst({ where: { id: req.params.id, pipeline: { tenantId: req.tenant.id } }, include: { _count: { select: { orders: true } } } });
  if (!existing) throw new NotFoundError('Stage', req.params.id);
  if (existing._count.orders > 0) throw new ConflictError('На цій стадії є замовлення — спершу перенесіть їх', { orders: existing._count.orders });
  await db.stage.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

module.exports = router;
