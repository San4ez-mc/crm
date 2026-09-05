// §4.11 Return (повернення/обмін) — §9.11.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');

const router = express.Router();

router.get('/returns', asyncHandler(async (req, res) => {
  const { take = '50', skip = '0' } = req.query;
  const [items, total] = await Promise.all([
    db.return.findMany({
      where: { tenantId: req.tenant.id },
      include: { order: { include: { buyer: true } } },
      orderBy: { createdAt: 'desc' },
      take: Number(take),
      skip: Number(skip),
    }),
    db.return.count({ where: { tenantId: req.tenant.id } }),
  ]);
  res.json({ ok: true, data: items, meta: { total, take: Number(take), skip: Number(skip) } });
}));

router.post('/returns', asyncHandler(async (req, res) => {
  const { orderId, type, reason, status } = req.body || {};
  if (!orderId) throw new ValidationError('orderId обовʼязковий');
  if (!['return', 'exchange'].includes(type)) throw new ValidationError('type: return | exchange');
  const order = await db.order.findFirst({ where: { id: orderId, tenantId: req.tenant.id }, include: { stage: { select: { pipelineId: true } } } });
  if (!order) throw new NotFoundError('Order', orderId);
  const ret = await db.return.create({
    data: { tenantId: req.tenant.id, orderId, type, reason: reason || null, status: status || 'new' },
  });
  // Best-effort: переносимо замовлення на стадію "Повернення/обмін" тієї ж воронки, якщо вона
  // є (2026-09-05, за проханням власника) — щоб факт повернення/обміну було видно на дошці
  // замовлень, не лише в журналі повернень. Немає такої стадії — тихо пропускаємо, не блокуючи
  // створення самого Return.
  if (order.stage?.pipelineId) {
    const returnStage = await db.stage.findFirst({ where: { pipelineId: order.stage.pipelineId, name: 'Повернення/обмін' } });
    if (returnStage && returnStage.id !== order.stageId) {
      await db.order.update({ where: { id: order.id }, data: { stageId: returnStage.id } }).catch(() => {});
    }
  }
  res.status(201).json({ ok: true, data: ret });
}));

router.patch('/returns/:id', asyncHandler(async (req, res) => {
  const existing = await db.return.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Return', req.params.id);
  const { status, reason } = req.body || {};
  if (status && !['new', 'confirmed', 'completed'].includes(status)) throw new ValidationError('status: new | confirmed | completed');
  const ret = await db.return.update({
    where: { id: existing.id },
    data: { ...(status !== undefined ? { status } : {}), ...(reason !== undefined ? { reason } : {}) },
  });
  res.json({ ok: true, data: ret });
}));

module.exports = router;
