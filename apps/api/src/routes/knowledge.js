// База знань магазину (ТЗ-база-знань-магазину.md, 2026-09-04) — FAQ/політики/заперечення/
// скрипти в одному місці CRM, замість funnelKey SHOP_FAQ (дублювався на кожен бот) і
// векторної бази (без історії, шукала на кожне повідомлення). Перенесення самих воронок на
// ці ендпойнти (§3, §6 ТЗ) — окрема робота, тут лише сторона CRM: модель+API+UI.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');

const router = express.Router();

const KINDS = ['faq', 'policy', 'objection', 'script'];
const SCOPES = ['shop', 'category', 'supplier', 'product'];
const SOURCES = ['manual', 'imported_gdoc', 'from_dialog'];
// Ієрархія рівнів для дії "Підняти рівень" (Promote) — product/supplier піднімаються
// одразу до shop (немає проміжного рівня між ними й магазином), category — теж до shop.
const PROMOTE_TO = { product: 'category', category: 'shop', supplier: 'shop' };

// ── Профіль (короткі "завжди в промпті" факти) ───────────────────────────
router.get('/knowledge/profile', asyncHandler(async (req, res) => {
  const profile = await db.knowledgeProfile.findUnique({ where: { tenantId: req.tenant.id } });
  res.json({ ok: true, data: profile || { tenantId: req.tenant.id, producerLine: null, shippingLine: null, fittingLine: null, paymentLine: null, termsLine: null } });
}));

router.put('/knowledge/profile', asyncHandler(async (req, res) => {
  const { producerLine, shippingLine, fittingLine, paymentLine, termsLine } = req.body || {};
  const data = {
    producerLine: producerLine ?? null,
    shippingLine: shippingLine ?? null,
    fittingLine: fittingLine ?? null,
    paymentLine: paymentLine ?? null,
    termsLine: termsLine ?? null,
  };
  const profile = await db.knowledgeProfile.upsert({
    where: { tenantId: req.tenant.id },
    update: data,
    create: { tenantId: req.tenant.id, ...data },
  });
  res.json({ ok: true, data: profile });
}));

// ── Записи (FAQ/policy/objection/script) ─────────────────────────────────
router.get('/knowledge', asyncHandler(async (req, res) => {
  const { kind, tag, scope, active, q, categoryId, supplierId, productId, sort, take = '200', skip = '0' } = req.query;
  const where = {
    tenantId: req.tenant.id,
    ...(kind ? { kind: String(kind) } : {}),
    ...(tag ? { tags: { has: String(tag) } } : {}),
    ...(scope ? { scope: { in: String(scope).split(',').map((s) => s.trim()).filter(Boolean) } } : {}),
    ...(categoryId ? { categoryId: String(categoryId) } : {}),
    ...(supplierId ? { supplierId: String(supplierId) } : {}),
    ...(productId ? { productId: String(productId) } : {}),
    ...(active !== undefined ? { isActive: active === 'true' } : {}),
    ...(q ? { OR: [
      { question: { contains: String(q), mode: 'insensitive' } },
      { answer: { contains: String(q), mode: 'insensitive' } },
    ] } : {}),
  };
  const [items, total] = await Promise.all([
    db.knowledgeEntry.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, thumbnailUrl: true } },
      },
      orderBy: sort === 'asked' ? [{ askCount: 'desc' }, { updatedAt: 'desc' }] : [{ priority: 'desc' }, { updatedAt: 'desc' }],
      take: Number(take),
      skip: Number(skip),
    }),
    db.knowledgeEntry.count({ where }),
  ]);
  res.json({ ok: true, data: items, meta: { total, take: Number(take), skip: Number(skip) } });
}));

router.post('/knowledge', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.kind || !KINDS.includes(b.kind)) throw new ValidationError(`kind має бути одним з: ${KINDS.join(', ')}`);
  if (!b.answer || !String(b.answer).trim()) throw new ValidationError('answer обовʼязковий');
  const scope = b.scope && SCOPES.includes(b.scope) ? b.scope : 'shop';
  const entry = await db.knowledgeEntry.create({
    data: {
      tenantId: req.tenant.id,
      kind: b.kind,
      question: b.question || null,
      answer: String(b.answer),
      tags: Array.isArray(b.tags) ? b.tags : [],
      scope,
      categoryId: scope === 'category' ? (b.categoryId || null) : null,
      supplierId: scope === 'supplier' ? (b.supplierId || null) : null,
      productId: scope === 'product' ? (b.productId || null) : null,
      priority: Number(b.priority) || 0,
      isActive: b.isActive !== undefined ? !!b.isActive : true,
      source: b.source && SOURCES.includes(b.source) ? b.source : 'manual',
      createdBy: b.createdBy || null,
    },
  });
  res.status(201).json({ ok: true, data: entry });
}));

router.patch('/knowledge/:id', asyncHandler(async (req, res) => {
  const existing = await db.knowledgeEntry.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('KnowledgeEntry', req.params.id);
  const b = req.body || {};
  const scope = b.scope !== undefined ? (SCOPES.includes(b.scope) ? b.scope : existing.scope) : undefined;
  const entry = await db.knowledgeEntry.update({
    where: { id: existing.id },
    data: {
      ...(b.kind !== undefined ? { kind: KINDS.includes(b.kind) ? b.kind : existing.kind } : {}),
      ...(b.question !== undefined ? { question: b.question || null } : {}),
      ...(b.answer !== undefined ? { answer: String(b.answer) } : {}),
      ...(b.tags !== undefined ? { tags: Array.isArray(b.tags) ? b.tags : [] } : {}),
      ...(scope !== undefined ? { scope } : {}),
      ...(b.categoryId !== undefined ? { categoryId: b.categoryId || null } : {}),
      ...(b.supplierId !== undefined ? { supplierId: b.supplierId || null } : {}),
      ...(b.productId !== undefined ? { productId: b.productId || null } : {}),
      ...(b.priority !== undefined ? { priority: Number(b.priority) || 0 } : {}),
      ...(b.isActive !== undefined ? { isActive: !!b.isActive } : {}),
    },
  });
  res.json({ ok: true, data: entry });
}));

router.delete('/knowledge/:id', asyncHandler(async (req, res) => {
  const existing = await db.knowledgeEntry.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('KnowledgeEntry', req.params.id);
  await db.knowledgeEntry.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

// ── Копіювати запис на інші товари/категорії/постачальники (незалежні копії) ─
router.post('/knowledge/:id/copy', asyncHandler(async (req, res) => {
  const existing = await db.knowledgeEntry.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('KnowledgeEntry', req.params.id);
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
  if (!targets.length) throw new ValidationError('targets обовʼязковий (список {scope, categoryId?, supplierId?, productId?})');
  const created = await db.$transaction(targets.map((t) => {
    const scope = SCOPES.includes(t.scope) ? t.scope : 'shop';
    return db.knowledgeEntry.create({
      data: {
        tenantId: req.tenant.id,
        kind: existing.kind,
        question: existing.question,
        answer: existing.answer,
        tags: existing.tags,
        scope,
        categoryId: scope === 'category' ? (t.categoryId || null) : null,
        supplierId: scope === 'supplier' ? (t.supplierId || null) : null,
        productId: scope === 'product' ? (t.productId || null) : null,
        priority: existing.priority,
        isActive: true,
        source: 'manual',
      },
    });
  }));
  res.status(201).json({ ok: true, data: created });
}));

// ── Підняти рівень (product→category, category/supplier→shop) — той самий запис ─
router.post('/knowledge/:id/promote', asyncHandler(async (req, res) => {
  const existing = await db.knowledgeEntry.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('KnowledgeEntry', req.params.id);
  const nextScope = PROMOTE_TO[existing.scope];
  if (!nextScope) throw new ValidationError('Цей запис уже на найвищому рівні (весь магазин)');

  let categoryId = null;
  if (nextScope === 'category') {
    if (!existing.productId) throw new ValidationError('Немає товару, щоб визначити категорію');
    const product = await db.product.findFirst({ where: { id: existing.productId, tenantId: req.tenant.id }, select: { categoryId: true } });
    if (!product?.categoryId) throw new ValidationError('У товару не вказана категорія — підняти нема куди, оберіть «Весь магазин» вручну');
    categoryId = product.categoryId;
  }

  const entry = await db.knowledgeEntry.update({
    where: { id: existing.id },
    data: {
      scope: nextScope,
      categoryId: nextScope === 'category' ? categoryId : null,
      supplierId: null,
      productId: null,
    },
  });
  res.json({ ok: true, data: entry });
}));

// scope: "shop" | "category:<id>" | "supplier:<id>" | "product:<id>" — при product:
// підвантажуємо ще categoryId і supplierId товару, щоб знайти й policy/faq-записи,
// прив'язані до всієї категорії або постачальника цього товару.
async function resolveScopeIds(tenantId, scope) {
  let categoryId = null; let supplierId = null; let productId = null;
  if (scope && String(scope).startsWith('category:')) categoryId = String(scope).split(':')[1];
  if (scope && String(scope).startsWith('supplier:')) supplierId = String(scope).split(':')[1];
  if (scope && String(scope).startsWith('product:')) {
    productId = String(scope).split(':')[1];
    const product = await db.product.findFirst({ where: { id: productId, tenantId }, select: { categoryId: true, supplierId: true } });
    categoryId = product?.categoryId || null;
    supplierId = product?.supplierId || null;
  }
  return { categoryId, supplierId, productId };
}

// ── Контекст (усі активні записи в скоупі, БЕЗ пошуку за словом) ──────────
// 2026-09-17 (власник, живий кейс "фолбек для питань не по скрипту" — /knowledge/search нижче
// шукає через to_tsvector('simple'), який НЕ має української морфології: "кишені" в питанні
// клієнта і "кишеня" в записі KB — це для 'simple' ДВА РІЗНІ токени, збігу нема навіть коли
// відповідь у базі точно є). При розмірі бази в кілька десятків записів на магазин найнадійніше —
// не шукати взагалі, а віддати ВСІ активні записи скоупу (магазин+категорія+товар) прямо в
// compose(), і нехай LLM сама вирішує релевантність — це вже смислове читання, не токен-збіг.
router.get('/knowledge/context', asyncHandler(async (req, res) => {
  const { scope } = req.query;
  const { categoryId, supplierId, productId } = await resolveScopeIds(req.tenant.id, scope);
  const items = await db.knowledgeEntry.findMany({
    where: {
      tenantId: req.tenant.id,
      isActive: true,
      OR: [
        { scope: 'shop' },
        ...(categoryId ? [{ scope: 'category', categoryId }] : []),
        ...(supplierId ? [{ scope: 'supplier', supplierId }] : []),
        ...(productId ? [{ scope: 'product', productId }] : []),
      ],
    },
    select: { id: true, kind: true, question: true, answer: true, tags: true, scope: true, priority: true },
    orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
    take: 60,
  });
  res.json({ ok: true, data: items });
}));

// ── Пошук (Postgres to_tsvector('simple'), без вектора — досить на кілька десятків записів) ──
router.get('/knowledge/search', asyncHandler(async (req, res) => {
  const { q, scope, limit = '3' } = req.query;
  if (!q || !String(q).trim()) return res.json({ ok: true, data: [] });
  const { categoryId, supplierId, productId } = await resolveScopeIds(req.tenant.id, scope);

  const rows = await db.$queryRaw`
    SELECT id, kind, question, answer, tags, scope, "categoryId", "supplierId", "productId", priority,
      ts_rank(
        to_tsvector('simple', coalesce(question, '') || ' ' || answer || ' ' || array_to_string(tags, ' ')),
        plainto_tsquery('simple', ${String(q)})
      ) AS rank
    FROM "KnowledgeEntry"
    WHERE "tenantId" = ${req.tenant.id}
      AND "isActive" = true
      AND (
        scope = 'shop'
        OR (scope = 'category' AND "categoryId" = ${categoryId})
        OR (scope = 'supplier' AND "supplierId" = ${supplierId})
        OR (scope = 'product' AND "productId" = ${productId})
      )
      AND to_tsvector('simple', coalesce(question, '') || ' ' || answer || ' ' || array_to_string(tags, ' '))
          @@ plainto_tsquery('simple', ${String(q)})
    ORDER BY rank DESC, priority DESC
    LIMIT ${Number(limit) || 3}
  `;
  res.json({ ok: true, data: rows });
}));

// ── askManager → чернетка запису (звідси росте база) ─────────────────────
router.post('/knowledge/from-dialog', asyncHandler(async (req, res) => {
  const { question, sessionId, productId } = req.body || {};
  if (!question || !String(question).trim()) throw new ValidationError('question обовʼязковий');
  const normalized = String(question).trim().toLowerCase().replace(/\s+/g, ' ');

  // 2026-09-29 (власник: «лічильник, скільки разів кожне питання задавалось людьми»): те саме питання — зокрема
  // іншими словами — не плодить дубль, а збільшує askCount існуючого запису (будь-якої давності, будь-якого джерела).
  const all = await db.knowledgeEntry.findMany({
    where: { tenantId: req.tenant.id, question: { not: null } },
    select: { id: true, question: true, productId: true },
  });
  const dup = all.find((r) => String(r.question || '').split('|').some((v) => v.trim().toLowerCase().replace(/\s+/g, ' ') === normalized))
    || all.find((r) => (r.productId || null) === (productId || null) && similarQuestion(r.question, question))
    || null;
  if (dup) {
    const bumped = await db.knowledgeEntry.update({ where: { id: dup.id }, data: { askCount: { increment: 1 }, lastAskedAt: new Date() } });
    return res.json({ ok: true, data: bumped, deduped: true });
  }

  const entry = await db.knowledgeEntry.create({
    data: {
      tenantId: req.tenant.id,
      kind: 'faq',
      question: String(question).trim(),
      answer: '',
      scope: productId ? 'product' : 'shop',
      productId: productId || null,
      isActive: false,
      source: 'from_dialog',
      sessionId: sessionId || null,
      askCount: 1,
      lastAskedAt: new Date(),
    },
  });
  res.status(201).json({ ok: true, data: entry });
}));

// Бот відповів клієнту цим записом — +1 до «скільки разів питали».
router.post('/knowledge/:id/hit', asyncHandler(async (req, res) => {
  const e = await db.knowledgeEntry.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, select: { id: true } });
  if (!e) throw new NotFoundError('KnowledgeEntry', req.params.id);
  const r = await db.knowledgeEntry.update({ where: { id: e.id }, data: { askCount: { increment: 1 }, lastAskedAt: new Date() }, select: { id: true, askCount: true } });
  res.json({ ok: true, data: r });
}));

// Схожість питань — ТОЙ САМИЙ критерій, що в боті (Flows: shopAgent/kbRules.js kbSimilarity), 2026-09-29.
// Основи значущих слів (перші 5 літер слова ≥4 літер, без службових, із синонімами магазинних тем);
// схожі, якщо Жаккар ≥0.5, або ≥2 спільні основи покривають ≥75% коротшого питання при Жаккарі ≥0.34.
// Різні артикули в питаннях — завжди різні питання.
const KB_STOP = new Set(['яка', 'який', 'яке', 'які', 'якої', 'якого', 'чи', 'можна', 'буде', 'будуть', 'мені', 'вас', 'ваш', 'ваша', 'ваше', 'ваші', 'цей', 'ця', 'це', 'цього', 'цієї', 'такий', 'така', 'таке', 'дуже', 'також', 'ще', 'ось', 'будь', 'ласка', 'підкажіть', 'скажіть', 'хочу', 'треба', 'потрібно', 'клієнт', 'клієнта', 'питає', 'цікавить', 'товар', 'товару', 'модель', 'моделі', 'магазин', 'магазину', 'чоловічий', 'чоловіча', 'чоловічі', 'артикул', 'скільки', 'нова', 'новою', 'нової', 'є', 'а', 'і', 'та', 'в', 'у', 'на', 'з', 'до', 'для', 'по', 'не', 'як', 'що']);
const KB_SYN = { 'кошту': 'ціна', 'варті': 'ціна', 'ціни': 'ціна', 'ціну': 'ціна', 'прайс': 'ціна', 'оглян': 'примі', 'помір': 'примі', 'перес': 'доста', 'сидит': 'сидіт', 'сідає': 'сидіт', 'линят': 'линяє' };
function stemsOf(t) {
  return new Set(String(t || '').toLowerCase().replace(/[’'`ʼ]/g, '').split(/[^a-zа-яіїєґ0-9]+/i)
    .filter((w) => w.length >= 4 && !KB_STOP.has(w) && !/^\d+$/.test(w)).map((w) => KB_SYN[w.slice(0, 5)] || w.slice(0, 5)));
}
function articlesOf(t) { return new Set((String(t || '').match(/\b[a-z]{0,4}\d{3,8}\b/gi) || []).map((x) => x.toUpperCase())); }
function similarQuestion(a, b) {
  const aa = articlesOf(a), ab = articlesOf(b);
  if (aa.size && ab.size && ![...aa].some((x) => ab.has(x))) return false;
  const A = stemsOf(a); const B = stemsOf(b);
  if (!A.size || !B.size) return false;
  let inter = 0; for (const w of A) if (B.has(w)) inter += 1;
  if (!inter) return false;
  const jac = inter / (A.size + B.size - inter);
  const cover = inter / Math.min(A.size, B.size);
  return jac >= 0.5 || (inter >= 2 && cover >= 0.75 && jac >= 0.34);
}

// ── Разовий імпорт з CSV/markdown "питання;відповідь;теги" ───────────────
router.post('/knowledge/import', asyncHandler(async (req, res) => {
  const { text, kind, preview } = req.body || {};
  if (!text || !String(text).trim()) throw new ValidationError('text обовʼязковий (CSV/markdown-рядки "питання;відповідь;теги")');
  const rows = String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [question, answer, tagsStr] = line.split(';').map((s) => (s || '').trim());
    return { question: question || null, answer: answer || '', tags: tagsStr ? tagsStr.split(',').map((t) => t.trim()).filter(Boolean) : [] };
  }).filter((r) => r.answer);

  if (preview) return res.json({ ok: true, data: { rows, count: rows.length } });

  const created = await db.$transaction(rows.map((r) => db.knowledgeEntry.create({
    data: {
      tenantId: req.tenant.id,
      kind: kind && KINDS.includes(kind) ? kind : 'faq',
      question: r.question,
      answer: r.answer,
      tags: r.tags,
      scope: 'shop',
      source: 'imported_gdoc',
    },
  })));
  res.status(201).json({ ok: true, data: { imported: created.length } });
}));

module.exports = router;
