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
  const { type, reason, status, ttn, exchangeFor, source, funnelSessionId, igUsername, senderName } = req.body || {};
  let { orderId } = req.body || {};
  if (!['return', 'exchange'].includes(type)) throw new ValidationError('type: return | exchange');
  // Без orderId — за розмовою воронки (2026-10-14): замовлення, оформлені менеджером у чаті, у CRM не потрапляли, тож бот не мав
  // до чого привʼязати обмін/повернення — розділ «Повернення/обміни» був порожній (9 справжніх обмінів/повернень за 11–13.10).
  // Привʼязуємо до картки цієї розмови (є на кожну розмову бота); нема — створюємо картку з нікнеймом. Без покупця картка —
  // не «замовлення» в аналітиці (lib/margin ORDER_PLACED_WHERE), тож продажі не спотворюються.
  if (!orderId && funnelSessionId) {
    let card = await db.order.findFirst({ where: { tenantId: req.tenant.id, funnelSessionId: String(funnelSessionId) }, select: { id: true } });
    if (!card) card = await db.order.create({ data: { tenantId: req.tenant.id, funnelSessionId: String(funnelSessionId), sourceName: 'Instagram', lastClientAt: new Date(), ...(senderName ? { contactName: String(senderName).slice(0, 120) } : {}), ...(igUsername ? { contactIg: String(igUsername).slice(0, 120) } : {}) }, select: { id: true } });
    orderId = card.id;
  }
  if (!orderId) throw new ValidationError('orderId або funnelSessionId обовʼязковий');
  const order = await db.order.findFirst({ where: { id: orderId, tenantId: req.tenant.id }, include: { stage: { select: { pipelineId: true } } } });
  if (!order) throw new NotFoundError('Order', orderId);
  const ret = await db.return.create({
    data: { tenantId: req.tenant.id, orderId, type, reason: reason || null, status: status || 'new', ttn: ttn ? String(ttn).replace(/\D/g, '') || null : null, exchangeFor: exchangeFor || null, source: source || null },
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
  const { status, reason, ttn, exchangeFor } = req.body || {};
  if (status && !['new', 'confirmed', 'completed'].includes(status)) throw new ValidationError('status: new | confirmed | completed');
  const ret = await db.return.update({
    where: { id: existing.id },
    data: { ...(status !== undefined ? { status } : {}), ...(reason !== undefined ? { reason } : {}), ...(ttn !== undefined ? { ttn: ttn ? String(ttn).replace(/\D/g, '') || null : null } : {}), ...(exchangeFor !== undefined ? { exchangeFor: exchangeFor || null } : {}) },
  });
  res.json({ ok: true, data: ret });
}));

module.exports = router;
