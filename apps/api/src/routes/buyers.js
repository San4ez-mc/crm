// §4.6 Buyer — дедуп за phone у межах tenant.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');
const { igOrNull, igSearchTerm, normalizeInstagram } = require('../lib/instagram');

const router = express.Router();

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

router.get('/buyers', asyncHandler(async (req, res) => {
  const { q, take = '50', skip = '0' } = req.query;
  // 2026-10-18: посилання на Instagram / @нік → пошук за нікнеймом. Телефон — лише коли в запиті є цифри: раніше
  // normalizePhone("Олена") давав '' і `phone contains ''` повертав УСІХ покупців на будь-який пошук за імʼям.
  const qs = String(q || '').trim();
  const ig = igSearchTerm(qs);
  const phoneQ = normalizePhone(qs);
  const where = {
    tenantId: req.tenant.id,
    ...(qs ? { OR: ig ? [
      { igUsername: { equals: ig, mode: 'insensitive' } },
    ] : [
      { fullName: { contains: qs, mode: 'insensitive' } },
      ...(phoneQ.replace(/\D/g, '').length >= 3 ? [{ phone: { contains: phoneQ } }] : []),
      { igUsername: { contains: qs.replace(/^@/, ''), mode: 'insensitive' } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    db.buyer.findMany({
      where,
      include: { orders: { select: { id: true, createdAt: true, items: { select: { price: true, quantity: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: Number(take),
      skip: Number(skip),
    }),
    db.buyer.count({ where }),
  ]);
  const data = items.map((b) => {
    const ordersCount = b.orders.length;
    const totalSpent = b.orders.reduce((sum, o) => sum + o.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0), 0);
    const lastOrderAt = b.orders.reduce((max, o) => (!max || o.createdAt > max ? o.createdAt : max), null);
    return { ...b, orders: undefined, ordersCount, totalSpent, lastOrderAt };
  });
  res.json({ ok: true, data, meta: { total, take: Number(take), skip: Number(skip) } });
}));

// find-or-create за телефоном — те, що сьогодні викликає воронка при оформленні замовлення (§5).
router.post('/buyers/find-or-create', asyncHandler(async (req, res) => {
  const { phone, fullName, igUsername } = req.body || {};
  if (!phone) throw new ValidationError('phone обовʼязковий');
  const normalized = normalizePhone(phone);
  const ig = igOrNull(igUsername); // лише нікнейм (посилання/@нік → нік), lib/instagram.js
  const buyer = await db.buyer.upsert({
    where: { tenantId_phone: { tenantId: req.tenant.id, phone: normalized } },
    update: { ...(fullName ? { fullName } : {}), ...(ig ? { igUsername: ig } : {}) },
    create: { tenantId: req.tenant.id, phone: normalized, fullName: fullName || null, igUsername: ig },
  });
  res.json({ ok: true, data: buyer });
}));

// Пам'ять вимірів клієнта (Buyer.knownMeasurements): читання-без-створення за phone АБО
// igUsername — щоб воронка могла впізнати клієнта РАНІШЕ, ніж дізнається телефон (Instagram-
// боти знають igUsername з першого повідомлення, а phone — лише на кроці оформлення, коли Buyer
// вже точно існує через find-or-create). МАЄ стояти ПЕРЕД GET /buyers/:id, інакше Express
// сприйме "lookup" як :id.
router.get('/buyers/lookup', asyncHandler(async (req, res) => {
  const { phone, igUsername } = req.query || {};
  const normalizedPhone = phone ? normalizePhone(phone) : '';
  if (!normalizedPhone && !igUsername) {
    return res.json({ ok: true, data: null });
  }
  const or = [];
  if (normalizedPhone) or.push({ phone: normalizedPhone });
  if (igUsername) or.push({ igUsername: { equals: normalizeInstagram(igUsername) || String(igUsername), mode: 'insensitive' } });
  const buyer = await db.buyer.findFirst({
    where: { tenantId: req.tenant.id, OR: or },
    orderBy: { updatedAt: 'desc' },
  });
  res.json({ ok: true, data: buyer || null });
}));

router.get('/buyers/:id', asyncHandler(async (req, res) => {
  const buyer = await db.buyer.findFirst({
    where: { id: req.params.id, tenantId: req.tenant.id },
    include: { orders: { orderBy: { createdAt: 'desc' }, include: { items: true, stage: true, returns: true } } },
  });
  if (!buyer) throw new NotFoundError('Buyer', req.params.id);
  res.json({ ok: true, data: buyer });
}));

router.patch('/buyers/:id', asyncHandler(async (req, res) => {
  const existing = await db.buyer.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Buyer', req.params.id);
  const { fullName, phone, igUsername, knownMeasurements, knownShipping } = req.body || {};
  const ig = igUsername !== undefined ? igOrNull(igUsername) : undefined;
  if (igUsername && !ig) throw new ValidationError(`Не вдалося розпізнати Instagram-нікнейм у «${String(igUsername).slice(0, 80)}» — вставте посилання на профіль або нікнейм`);
  if (phone !== undefined && !normalizePhone(phone)) throw new ValidationError('Телефон покупця не може бути порожнім');
  // knownMeasurements — MERGE по ключах (param name), не overwrite: одна воронка може оновити
  // лише параметри поточної категорії (напр. "зріст"/"вага"), інша сесія раніше — інші
  // (напр. "розмір ноги" з іншої категорії товару того ж клієнта). Обидва мають зберігатись.
  let mergedMeasurements;
  if (knownMeasurements !== undefined) {
    if (knownMeasurements === null) {
      mergedMeasurements = null;
    } else if (typeof knownMeasurements === 'object' && !Array.isArray(knownMeasurements)) {
      mergedMeasurements = { ...(existing.knownMeasurements || {}), ...knownMeasurements };
    } else {
      throw new ValidationError('knownMeasurements має бути обʼєктом {[param]: value} або null');
    }
  }
  // knownShipping — теж MERGE (можна оновити лише "місто", лишивши раніше збережений ПІБ
  // отримувача незмінним), той самий принцип, що knownMeasurements.
  let mergedShipping;
  if (knownShipping !== undefined) {
    if (knownShipping === null) {
      mergedShipping = null;
    } else if (typeof knownShipping === 'object' && !Array.isArray(knownShipping)) {
      mergedShipping = { ...(existing.knownShipping || {}), ...knownShipping };
    } else {
      throw new ValidationError('knownShipping має бути обʼєктом {fullName?,phone?,city?,warehouse?} або null');
    }
  }
  const buyer = await db.buyer.update({
    where: { id: existing.id },
    data: {
      ...(fullName !== undefined ? { fullName } : {}),
      ...(phone !== undefined ? { phone: normalizePhone(phone) } : {}),
      ...(ig !== undefined ? { igUsername: ig } : {}),
      ...(knownMeasurements !== undefined ? { knownMeasurements: mergedMeasurements } : {}),
      ...(knownShipping !== undefined ? { knownShipping: mergedShipping } : {}),
    },
  });
  res.json({ ok: true, data: buyer });
}));

module.exports = router;
