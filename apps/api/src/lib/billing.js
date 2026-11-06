// Оплата підписки (2026-11-06): створення платежу, перевірка його у WayForPay і застосування (продовжити тариф магазину або створити
// нову компанію тому, хто платив із демо-акаунта). Єдине місце логіки — і сповіщення від WayForPay (serviceUrl), і повернення
// користувача в адмінку, і кнопка «Перевірити оплату» ведуть сюди.
const crypto = require('node:crypto');
const { db } = require('@crm/db');
const logger = require('@crm/logger');
const { ValidationError } = require('@crm/errors');
const wfp = require('./wayforpay');
const ssoClient = require('./ssoClient');
const { PLANS, priceUsdFor, extendedEnd } = require('./plans');
const { fetchUsdToUahFromNbu } = require('./currency');

// Етапи замовлення у новій компанії. Назви збігаються з тими, які знає CRM для статусів Нової пошти (lib/novaPoshta.js, lib/orderOps.js).
const DEFAULT_STAGES = [
  'Презентація товару', 'Написав параметри', 'Очікуємо дані та оплату', 'Замовлення прийняте', 'Замовлення оформлене в постачальника',
  'Відправлено', 'Посилка зберігається на пошті', 'Не забрав на пошті', 'Клієнт забрав на пошті', 'Повернення/обмін',
];

const publicBase = () => String(process.env.CRM_PUBLIC_URL || process.env.ADMIN_BASE_URL || 'https://pcrm.fineko.space').replace(/\/$/, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Створює платіж (pending) і повертає форму для WayForPay. */
async function createCheckout({ tenant, user, plan, months, email, name, companyName }) {
  if (!wfp.configured()) throw new ValidationError('Онлайн-оплата ще не підключена. Напишіть нам, і ми виставимо рахунок вручну.');
  const usd = priceUsdFor(plan, months);
  if (usd == null) throw new ValidationError('Цей тариф не оплачується онлайн або невірний період');
  const isDemo = !!tenant.isDemo;
  const buyerEmail = String(email || (user && user.email) || '').trim().toLowerCase();
  // Із демо-акаунта купують нову компанію: потрібні email нового власника і назва. Продовження існуючого магазину бере email із входу.
  if (isDemo && !EMAIL_RE.test(buyerEmail)) throw new ValidationError('Вкажіть email — на нього створимо вашу компанію і надішлемо лист для входу');
  if (isDemo && !String(companyName || '').trim()) throw new ValidationError('Вкажіть назву вашого магазину');

  const currency = wfp.cfg().currency;
  let amount = usd;
  if (currency === 'UAH') {
    const rate = Number(tenant.usdExchangeRate) > 0 ? Number(tenant.usdExchangeRate) : await fetchUsdToUahFromNbu();
    amount = Math.ceil(usd * rate);
  }
  const orderReference = `fcrm-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const p = PLANS[plan];
  const productName = `Fineko CRM · ${p.name} · ${months} міс.`;
  const payment = await db.billingPayment.create({
    data: {
      tenantId: tenant.id, userId: user ? user.id : null, userEmail: buyerEmail || null, userName: String(name || (user && user.name) || '').trim().slice(0, 120) || null,
      companyName: isDemo ? String(companyName).trim().slice(0, 120) : null, plan, months: Number(months), amountUsd: usd, amount, currency, orderReference,
    },
  });
  const form = wfp.buildPurchase({
    orderReference, amount, currency, productName, clientEmail: buyerEmail || undefined,
    returnUrl: `${publicBase()}/api/billing/wayforpay/return`, serviceUrl: `${publicBase()}/api/billing/wayforpay/callback`,
  });
  return { paymentId: payment.id, orderReference, amount, currency, ...form };
}

/** Створює нову компанію оплатившому й дає йому доступ. Ідемпотентно: повторний виклик нічого не дублює. */
async function provisionCompany(payment) {
  if (payment.newTenantId) return db.tenant.findUnique({ where: { id: payment.newTenantId } });
  const plan = PLANS[payment.plan];
  const company = await db.tenant.create({
    data: {
      name: payment.companyName || `Магазин ${payment.userEmail || ''}`.trim(),
      plan: payment.plan, planEndsAt: extendedEnd(null, payment.months), isDemo: false,
      prepaymentAmount: 200, expectedRefusalPct: 23, forecastRefusalPct: 20, forecastReturnPct: 3,
      publicKey: 'pk_' + crypto.randomUUID().replace(/-/g, ''),
      shopDescription: `Магазин «${payment.companyName || ''}» (тариф ${plan ? plan.name : payment.plan})`,
      pipelines: { create: { name: 'Замовлення', stages: { create: DEFAULT_STAGES.map((name, i) => ({ name, order: i + 1 })) } } },
    },
  });
  await db.billingPayment.update({ where: { id: payment.id }, data: { newTenantId: company.id } });
  return company;
}

/** Застосовує оплачений платіж: продовжує тариф або створює компанію (+ доступ у SSO). Повертає короткий результат для екрана. */
async function applyPaid(paymentId) {
  const payment = await db.billingPayment.findUnique({ where: { id: paymentId }, include: { tenant: true } });
  if (!payment || payment.status !== 'paid') return null;
  if (payment.appliedAt) return { already: true, newTenantId: payment.newTenantId };

  if (payment.tenant.isDemo) {
    const company = await provisionCompany(payment);
    await ssoClient.provisionShopOwner({ email: payment.userEmail, displayName: payment.userName, projectId: company.id });
    await db.billingPayment.update({ where: { id: payment.id }, data: { appliedAt: new Date() } });
    logger.info('Оплата застосована: створено компанію', { paymentId: payment.id, tenantId: company.id });
    return { newTenantId: company.id, companyName: company.name, invitedEmail: payment.userEmail };
  }
  await db.tenant.update({ where: { id: payment.tenantId }, data: { plan: payment.plan, planEndsAt: extendedEnd(payment.tenant.planEndsAt, payment.months) } });
  await db.billingPayment.update({ where: { id: payment.id }, data: { appliedAt: new Date() } });
  logger.info('Оплата застосована: тариф продовжено', { paymentId: payment.id, tenantId: payment.tenantId });
  return { extended: true };
}

/**
 * Перевіряє платіж у WayForPay (довіряємо лише його відповіді CHECK_STATUS, сума і валюта мають збігатися з тим, що ми виставили)
 * і застосовує, якщо оплачено. Безпечно викликати багато разів. fromCallback — дані з підписаного повідомлення (для журналу).
 */
async function confirmPayment(orderReference, fromCallback = null) {
  let payment = await db.billingPayment.findUnique({ where: { orderReference } });
  if (!payment) return null;
  if (payment.status === 'pending') {
    let remote = null;
    try { remote = await wfp.checkStatus(orderReference); }
    catch (e) { logger.warn('WayForPay CHECK_STATUS не вдалось', { orderReference, error: e.message }); }
    if (remote && remote.transactionStatus) {
      const status = remote.transactionStatus;
      const sameMoney = Number(remote.amount) === Number(payment.amount) && String(remote.currency) === String(payment.currency);
      if (status === 'Approved' && sameMoney) {
        payment = await db.billingPayment.update({ where: { id: payment.id }, data: { status: 'paid', paidAt: new Date(), providerStatus: status, providerPayload: remote } });
      } else if (status === 'Approved' && !sameMoney) {
        logger.error('WayForPay: сума/валюта не збігаються з виставленими', { orderReference, remote: { amount: remote.amount, currency: remote.currency }, expected: { amount: String(payment.amount), currency: payment.currency } });
        payment = await db.billingPayment.update({ where: { id: payment.id }, data: { providerStatus: 'AmountMismatch', providerPayload: remote } });
      } else if (['Declined', 'Expired', 'Refunded', 'Voided'].includes(status)) {
        payment = await db.billingPayment.update({ where: { id: payment.id }, data: { status: 'failed', providerStatus: status, providerPayload: remote } });
      } else {
        payment = await db.billingPayment.update({ where: { id: payment.id }, data: { providerStatus: status } });
      }
    } else if (fromCallback) {
      await db.billingPayment.update({ where: { id: payment.id }, data: { providerStatus: fromCallback.transactionStatus || null } });
    }
  }
  let applied = null;
  if (payment.status === 'paid' && !payment.appliedAt) {
    try { applied = await applyPaid(payment.id); }
    catch (e) { logger.error('Оплату отримано, але застосувати не вдалось (повториться при наступній перевірці)', { orderReference, error: e.message }); }
    payment = await db.billingPayment.findUnique({ where: { orderReference } });
  } else if (payment.appliedAt) {
    applied = { already: true, newTenantId: payment.newTenantId };
  }
  return { payment, applied };
}

module.exports = { createCheckout, confirmPayment, applyPaid, provisionCompany, DEFAULT_STAGES };
