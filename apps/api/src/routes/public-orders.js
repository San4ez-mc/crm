// Відкритий вхід замовлень з лендінгу (2026-11-05, власник: «додати замовлення з лендінгу, а не з наших воронок»).
// Сторінка лендінгу публічна, тому повний tenant.apiKey (читає й змінює все) туди ставити не можна — для цього окремий
// Tenant.publicKey: він вміє лише створити замовлення. Захист від сміття: ключ, медовий пастка-поле, ліміт запитів з однієї адреси,
// склеювання повторного натискання (той самий телефон і той самий склад за 10 хв → повертаємо вже створене замовлення).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, AuthError } = require('@crm/errors');
const { itemsTotal, paymentFields } = require('../lib/orderOps');
const { igOrNull } = require('../lib/instagram');
const logger = require('@crm/logger');

const router = express.Router();

// ── Ліміт запитів: 8 за 10 хв з однієї адреси (памʼять процесу достатньо — це лише проти ботів-спамерів) ──
const HITS = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 8;
function tooMany(ip) {
  const now = Date.now();
  const arr = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5000) for (const [k, v] of HITS) if (!v.some((t) => now - t < WINDOW_MS)) HITS.delete(k);
  return arr.length > MAX_HITS;
}

const str = (v, max) => (v == null ? '' : String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max));

/** Українські номери: 0671234567 / 380671234567 / +38 (067) 123-45-67 → +380671234567. Інше — лишаємо цифри (не відкидаємо чужі номери). */
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return '+38' + digits;
  if (digits.length === 12 && digits.startsWith('380')) return '+' + digits;
  if (digits.length === 9) return '+380' + digits;
  return digits.length >= 10 && digits.length <= 15 ? '+' + digits : '';
}

// POST /api/public/landing-order
// Тіло: { key, name, phone, items:[{sku?, name, price, quantity?, properties?:[{name,value}]}], city?, warehouse?, comment?,
//         source?, paymentType?:'cod'|'partial'|'full', instagram?, utm?:{...}, website? (пастка: людина лишає порожнім) }
router.post('/public/landing-order', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (tooMany(ip)) return void res.status(429).json({ ok: false, error: { code: 'RATE_LIMIT', message: 'Забагато спроб — спробуйте за кілька хвилин' } });

  const key = str(req.header('x-public-key') || b.key, 80);
  const tenant = key ? await db.tenant.findUnique({ where: { publicKey: key } }) : null;
  if (!tenant) throw new AuthError('Невірний ключ магазину');

  // Пастка для ботів: це поле заховане від людини; заповнене — вдаємо успіх, нічого не створюємо.
  if (str(b.website, 200)) return void res.status(201).json({ ok: true, data: { orderId: null } });

  const name = str(b.name, 100);
  const phone = normalizePhone(b.phone);
  if (!name) throw new ValidationError('Вкажіть імʼя');
  if (!phone) throw new ValidationError('Вкажіть коректний номер телефону');

  const rawItems = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
  if (!rawItems.length) throw new ValidationError('Додайте хоча б один товар');
  // Артикул (sku) знайдено в каталозі магазину → ціну й назву беремо звідти (клієнт у браузері може підмінити ціну); інакше — як передано.
  const skus = [...new Set(rawItems.map((it) => str(it && it.sku, 60)).filter(Boolean))];
  const catalog = skus.length ? await db.product.findMany({ where: { tenantId: tenant.id, sku: { in: skus } }, select: { id: true, sku: true, name: true, customerName: true, price: true, supplierId: true } }) : [];
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const items = rawItems.map((it) => {
    const p = bySku.get(str(it && it.sku, 60));
    const qty = Math.min(Math.max(parseInt(it && it.quantity, 10) || 1, 1), 50);
    const price = p ? Number(p.price) : Number(it && it.price);
    const itemName = p ? (p.customerName || p.name) : str(it && it.name, 200);
    if (!itemName) throw new ValidationError('У товару немає назви');
    if (!Number.isFinite(price) || price < 0 || price > 1000000) throw new ValidationError(`Некоректна ціна товару «${itemName}»`);
    const properties = Array.isArray(it && it.properties)
      ? it.properties.slice(0, 10).map((x) => ({ name: str(x && x.name, 60), value: str(x && x.value, 100) })).filter((x) => x.name && x.value)
      : null;
    return { productId: p ? p.id : null, supplierId: p ? p.supplierId : null, name: itemName, price, quantity: qty, properties: properties && properties.length ? properties : null };
  });

  // Повторне натискання кнопки / подвійна відправка: той самий телефон, ті самі позиції, за останні 10 хв → вже створене замовлення.
  const buyer = await db.buyer.upsert({
    where: { tenantId_phone: { tenantId: tenant.id, phone } },
    update: {},
    create: { tenantId: tenant.id, phone, fullName: name, igUsername: igOrNull(b.instagram) },
  });
  if (!buyer.fullName) await db.buyer.update({ where: { id: buyer.id }, data: { fullName: name } }).catch(() => {});
  const sig = items.map((i) => `${i.name}|${i.price}|${i.quantity}`).sort().join(';');
  const recent = await db.order.findMany({
    where: { tenantId: tenant.id, buyerId: buyer.id, placedBy: 'Лендінг', createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
    include: { items: true }, take: 5,
  });
  const dup = recent.find((o) => o.items.map((i) => `${i.name}|${Number(i.price)}|${i.quantity}`).sort().join(';') === sig);
  if (dup) return void res.status(200).json({ ok: true, data: { orderId: dup.id, duplicate: true } });

  const pipeline = await db.pipeline.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { order: 'asc' }, take: 1 } } });
  // Замовлення з лендінгу вже оформлене клієнтом → одразу «Замовлення прийняте» (перша стадія воронки — «Презентація товару», це розмова бота).
  const accepted = pipeline ? await db.stage.findFirst({ where: { pipelineId: pipeline.id, name: 'Замовлення прийняте' }, select: { id: true } }) : null;
  const stageId = accepted?.id || pipeline?.stages?.[0]?.id || null;

  const ptype = ['cod', 'partial', 'full'].includes(b.paymentType) ? b.paymentType : 'cod';
  const payFields = paymentFields({ paymentType: ptype }, itemsTotal(items), null, tenant.prepaymentAmount);

  // «Джерело» картки: «Лендінг: <назва/адреса сторінки>». UTM-мітки (звідки прийшов на сторінку) і коментар клієнта — у коментар менеджеру.
  const source = str(b.source, 120) || 'без назви';
  const utm = b.utm && typeof b.utm === 'object' ? Object.entries(b.utm).slice(0, 8).map(([k, v]) => `${str(k, 30)}=${str(v, 80)}`).filter((x) => !x.startsWith('=')).join(', ') : '';
  const comment = [str(b.comment, 500), utm ? `UTM: ${utm}` : ''].filter(Boolean).join('\n');
  const city = str(b.city, 100); const warehouse = str(b.warehouse, 200);

  const order = await db.order.create({
    data: {
      tenantId: tenant.id, buyerId: buyer.id, stageId,
      sourceName: `Лендінг: ${source}`,
      managerComment: comment || null,
      shipping: city || warehouse ? { fullName: name, phone, ...(city ? { city } : {}), ...(warehouse ? { warehouse } : {}) } : null,
      placedAt: new Date(), placedBy: 'Лендінг',
      contactName: name, ...(igOrNull(b.instagram) ? { contactIg: igOrNull(b.instagram) } : {}),
      ...payFields,
      items: { create: items.map((it) => ({ productId: it.productId, name: it.name, price: it.price, quantity: it.quantity, properties: it.properties, isUpsell: false, supplierId: it.supplierId })) },
    },
    select: { id: true },
  });
  if (city || warehouse) {
    await db.buyer.update({ where: { id: buyer.id }, data: { knownShipping: { ...(buyer.knownShipping || {}), fullName: name, phone, ...(city ? { city } : {}), ...(warehouse ? { warehouse } : {}) } } }).catch(() => {});
  }
  logger.info('Замовлення з лендінгу', { tenantId: tenant.id, orderId: order.id, source });
  res.status(201).json({ ok: true, data: { orderId: order.id } });
}));

module.exports = router;
