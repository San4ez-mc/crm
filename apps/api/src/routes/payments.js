// Payment — доповнення до §9.14 (див. коментар у schema.prisma). Лише журнал: воронка
// пише факт оплати через POST /payments (Bearer tenant.apiKey), звірка лишається на її боці.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');

const router = express.Router();

router.get('/payments', asyncHandler(async (req, res) => {
  const { take = '100', skip = '0' } = req.query;
  const [items, total] = await Promise.all([
    db.payment.findMany({ where: { tenantId: req.tenant.id }, include: { order: { include: { buyer: true } } }, orderBy: { createdAt: 'desc' }, take: Number(take), skip: Number(skip) }),
    db.payment.count({ where: { tenantId: req.tenant.id } }),
  ]);
  res.json({ ok: true, data: items, meta: { total, take: Number(take), skip: Number(skip) } });
}));

router.post('/payments', asyncHandler(async (req, res) => {
  const { orderId, amount, method, status } = req.body || {};
  if (!orderId || amount === undefined) throw new ValidationError('orderId і amount обовʼязкові');
  const order = await db.order.findFirst({ where: { id: orderId, tenantId: req.tenant.id } });
  if (!order) throw new NotFoundError('Order', orderId);
  const payment = await db.payment.create({ data: { tenantId: req.tenant.id, orderId, amount, method: method || null, status: status || 'success' } });
  res.status(201).json({ ok: true, data: payment });
}));

module.exports = router;
