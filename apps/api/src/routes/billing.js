// Тариф і оплата підписки (2026-11-06). Дві частини:
//   publicRouter — без входу: сповіщення від WayForPay (serviceUrl) і повернення клієнта після оплати (returnUrl, браузер приходить POST-ом);
//   router       — для залогіненого користувача магазину: стан тарифу, «Оплатити», перевірка платежу, підказки-тури.
const express = require('express');
const { db } = require('@crm/db');
const logger = require('@crm/logger');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, ForbiddenError, NotFoundError } = require('@crm/errors');
const wfp = require('../lib/wayforpay');
const billing = require('../lib/billing');
const { PLANS, MONTH_OPTIONS, planStatus } = require('../lib/plans');

const adminBase = () => String(process.env.ADMIN_BASE_URL || process.env.CRM_PUBLIC_URL || 'https://pcrm.fineko.space').replace(/\/$/, '');

// ── Публічні: без входу ──────────────────────────────────────────────────
const publicRouter = express.Router();

// Сповіщення про платіж. Підпис обов'язковий; статус підтверджуємо окремим запитом до WayForPay (confirmPayment). Завжди відповідаємо
// «accept» на коректне сповіщення, інакше WayForPay повторюватиме його днями.
publicRouter.post('/billing/wayforpay/callback', express.text({ type: ['text/*', 'application/x-www-form-urlencoded'] }), asyncHandler(async (req, res) => {
  const data = wfp.parseCallbackBody(req.body);
  if (!data || !data.orderReference) return void res.status(400).json({ ok: false });
  if (!wfp.verifyPaymentData(data)) {
    logger.warn('WayForPay callback: невірний підпис', { orderReference: data.orderReference });
    return void res.status(400).json({ ok: false, error: 'bad signature' });
  }
  try { await billing.confirmPayment(String(data.orderReference), data); }
  catch (e) { logger.error('WayForPay callback: помилка обробки', { orderReference: data.orderReference, error: e.message }); }
  res.json(wfp.acceptResponse(String(data.orderReference)));
}));

// Клієнт повертається з оплати: WayForPay шле його POST-ом (іноді GET). Перекидаємо в адмінку на сторінку тарифу — вона сама перевірить платіж.
const backToAdmin = (req, res) => {
  const ref = String((req.body && req.body.orderReference) || req.query.orderReference || req.query.ref || '').slice(0, 80);
  res.redirect(303, `${adminBase()}/billing${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
};
publicRouter.post('/billing/wayforpay/return', express.urlencoded({ extended: false }), backToAdmin);
publicRouter.get('/billing/wayforpay/return', backToAdmin);

// ── Для користувача магазину (під resolveTenant) ─────────────────────────
const router = express.Router();

const paymentView = (p) => ({ id: p.id, orderReference: p.orderReference, plan: p.plan, months: p.months, amount: Number(p.amount), currency: p.currency, status: p.status, providerStatus: p.providerStatus, createdAt: p.createdAt, paidAt: p.paidAt, applied: !!p.appliedAt, newTenantId: p.newTenantId });

router.get('/billing/status', asyncHandler(async (req, res) => {
  const payments = await db.billingPayment.findMany({ where: { tenantId: req.tenant.id }, orderBy: { createdAt: 'desc' }, take: 10 });
  res.json({
    ok: true,
    data: {
      ...planStatus(req.tenant), isDemo: !!req.tenant.isDemo, canPayOnline: wfp.configured(), currency: wfp.cfg().currency,
      plans: Object.values(PLANS), monthOptions: Object.entries(MONTH_OPTIONS).map(([months, billable]) => ({ months: Number(months), billableMonths: billable })),
      payments: payments.map(paymentView),
    },
  });
}));

router.post('/billing/checkout', asyncHandler(async (req, res) => {
  if (!req.user) throw new ForbiddenError('Оплата доступна після входу в CRM (не за API-ключем)');
  const b = req.body || {};
  const out = await billing.createCheckout({ tenant: req.tenant, user: req.user, plan: String(b.plan || ''), months: Number(b.months) || 1, email: b.email, name: b.name, companyName: b.companyName });
  res.status(201).json({ ok: true, data: out });
}));

// Перевірка платежу (сторінка тарифу викликає її після повернення з оплати і кнопкою «Перевірити оплату»).
router.get('/billing/payments/:ref', asyncHandler(async (req, res) => {
  const payment = await db.billingPayment.findUnique({ where: { orderReference: String(req.params.ref) } });
  if (!payment || payment.tenantId !== req.tenant.id) throw new NotFoundError('Payment', req.params.ref);
  const r = await billing.confirmPayment(payment.orderReference);
  const fresh = r ? r.payment : payment;
  const company = fresh.newTenantId ? await db.tenant.findUnique({ where: { id: fresh.newTenantId }, select: { id: true, name: true } }) : null;
  res.json({ ok: true, data: { ...paymentView(fresh), company, invitedEmail: company ? fresh.userEmail : null } });
}));

// ── Підказки-тури: один раз кожному користувачу (id з SSO) ───────────────
router.get('/tours', asyncHandler(async (req, res) => {
  if (!req.user) return void res.json({ ok: true, data: { seen: [] } });
  const rows = await db.userTour.findMany({ where: { userId: req.user.id }, select: { tourKey: true } });
  res.json({ ok: true, data: { seen: rows.map((r) => r.tourKey) } });
}));
router.post('/tours/:key/seen', asyncHandler(async (req, res) => {
  if (!req.user) throw new ValidationError('Потрібен вхід у CRM');
  const key = String(req.params.key).slice(0, 60);
  await db.userTour.upsert({ where: { userId_tourKey: { userId: req.user.id, tourKey: key } }, update: {}, create: { userId: req.user.id, tourKey: key } });
  res.json({ ok: true, data: { key } });
}));

module.exports = { router, publicRouter };
