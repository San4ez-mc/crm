// WayForPay (2026-11-06): оплата підписки на CRM карткою. Документація: https://wiki.wayforpay.com
// Ключі — системні, у .env сервера (не per-tenant, бо гроші приходять на один рахунок власника):
//   WFP_MERCHANT_ACCOUNT  — ідентифікатор продавця (merchantAccount)
//   WFP_SECRET_KEY        — секретний ключ
//   WFP_MERCHANT_DOMAIN   — домен, зареєстрований у кабінеті WayForPay (напр. pcrm.fineko.space)
//   WFP_CURRENCY          — валюта рахунку: UAH (за замовчуванням) або USD
// Підпис усіх запитів — HMAC_MD5 від значень полів, склеєних через «;», секретним ключем.
const crypto = require('node:crypto');

const PAY_URL = 'https://secure.wayforpay.com/pay';
const API_URL = 'https://api.wayforpay.com/api';

const cfg = () => ({
  account: process.env.WFP_MERCHANT_ACCOUNT || '',
  secret: process.env.WFP_SECRET_KEY || '',
  domain: process.env.WFP_MERCHANT_DOMAIN || '',
  currency: (process.env.WFP_CURRENCY || 'UAH').toUpperCase(),
});
const configured = () => { const c = cfg(); return !!(c.account && c.secret && c.domain); };

function sign(parts, secret = cfg().secret) {
  return crypto.createHmac('md5', secret).update(parts.map((p) => (p == null ? '' : String(p))).join(';'), 'utf8').digest('hex');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const money = (n) => Number(n).toFixed(2);

/**
 * Поля для форми оплати. Браузер відправляє їх POST-ом на secure.wayforpay.com/pay (масиви productName[] повторюються).
 * Повертає {url, fields:[[name,value],...]} — адмінка малює приховану форму й сабмітить її.
 */
function buildPurchase({ orderReference, amount, currency, productName, clientEmail, returnUrl, serviceUrl, orderDate = Math.floor(Date.now() / 1000) }) {
  const c = cfg();
  if (!configured()) throw new Error('WayForPay не налаштований: потрібні WFP_MERCHANT_ACCOUNT, WFP_SECRET_KEY, WFP_MERCHANT_DOMAIN у .env');
  const amt = money(amount);
  const cur = currency || c.currency;
  const names = [productName]; const counts = [1]; const prices = [amt];
  const merchantSignature = sign([c.account, c.domain, orderReference, orderDate, amt, cur, ...names, ...counts, ...prices]);
  const fields = [
    ['merchantAccount', c.account], ['merchantAuthType', 'SimpleSignature'], ['merchantDomainName', c.domain],
    ['merchantTransactionSecureType', 'AUTO'], ['orderReference', orderReference], ['orderDate', String(orderDate)],
    ['amount', amt], ['currency', cur],
    ...names.map((n) => ['productName[]', n]), ...counts.map((n) => ['productCount[]', String(n)]), ...prices.map((n) => ['productPrice[]', n]),
    ['returnUrl', returnUrl], ['serviceUrl', serviceUrl], ['language', 'UA'],
    ...(clientEmail ? [['clientEmail', clientEmail]] : []),
    ['merchantSignature', merchantSignature],
  ];
  return { url: PAY_URL, fields };
}

// Підпис відповіді/повідомлення про платіж: merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode
function paymentSignature(d) {
  return sign([d.merchantAccount, d.orderReference, d.amount, d.currency, d.authCode, d.cardPan, d.transactionStatus, d.reasonCode]);
}
function verifyPaymentData(d) {
  return !!(d && d.merchantSignature && configured() && d.merchantAccount === cfg().account && safeEqual(paymentSignature(d), d.merchantSignature));
}

/** Тіло повідомлення від WayForPay: зазвичай JSON, іноді JSON лежить єдиним ключем форми. Повертає об'єкт або null. */
function parseCallbackBody(body) {
  if (!body) return null;
  if (typeof body === 'string') { try { return JSON.parse(body); } catch { return null; } }
  if (typeof body === 'object') {
    if (body.orderReference) return body;
    const keys = Object.keys(body);
    if (keys.length === 1) { try { return JSON.parse(keys[0]); } catch { return null; } }
  }
  return null;
}

/** Відповідь, якою WayForPay підтверджуємо отримання повідомлення (інакше він повторює його кілька днів). */
function acceptResponse(orderReference, status = 'accept') {
  const time = Math.floor(Date.now() / 1000);
  return { orderReference, status, time, signature: sign([orderReference, status, time]) };
}

/** Офіційна перевірка статусу платежу в WayForPay — довіряємо їй, а не лише тому, що прийшло в браузері. */
async function checkStatus(orderReference) {
  const c = cfg();
  if (!configured()) throw new Error('WayForPay не налаштований');
  const res = await fetch(API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionType: 'CHECK_STATUS', merchantAccount: c.account, orderReference, merchantSignature: sign([c.account, orderReference]), apiVersion: 1 }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`WayForPay CHECK_STATUS HTTP ${res.status}`);
  const j = await res.json();
  // Якщо відповідь підписана — перевіряємо підпис; без підпису (помилковий запит) повертаємо як є, рішення прийме викликач за transactionStatus.
  if (j && j.merchantSignature && j.transactionStatus) {
    const ok = safeEqual(paymentSignature({ ...j, merchantAccount: j.merchantAccount || c.account }), j.merchantSignature);
    if (!ok) throw new Error('WayForPay CHECK_STATUS: невірний підпис відповіді');
  }
  return j;
}

module.exports = { configured, cfg, sign, buildPurchase, paymentSignature, verifyPaymentData, parseCallbackBody, acceptResponse, checkStatus, PAY_URL };
