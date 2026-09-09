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
  const { kind, tag, scope, active, q, categoryId, supplierId, productId, take = '200', skip = '0' } = req.query;
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
        product: { select: { id: true, name: true } },
      },
      orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
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

// ── Пошук (Postgres to_tsvector('simple'), без вектора — досить на кілька десятків записів) ──
router.get('/knowledge/search', asyncHandler(async (req, res) => {
  const { q, scope, limit = '3' } = req.query;
  if (!q || !String(q).trim()) return res.json({ ok: true, data: [] });

  // scope: "shop" | "category:<id>" | "supplier:<id>" | "product:<id>" — при product:
  // підвантажуємо ще categoryId і supplierId товару, щоб знайти й policy/faq-записи,
  // прив'язані до всієї категорії або постачальника цього товару.
  let categoryId = null;
  let supplierId = null;
  let productId = null;
  if (scope && String(scope).startsWith('category:')) categoryId = String(scope).split(':')[1];
  if (scope && String(scope).startsWith('supplier:')) supplierId = String(scope).split(':')[1];
  if (scope && String(scope).startsWith('product:')) {
    productId = String(scope).split(':')[1];
    const product = await db.product.findFirst({ where: { id: productId, tenantId: req.tenant.id }, select: { categoryId: true, supplierId: true } });
    categoryId = product?.categoryId || null;
    supplierId = product?.supplierId || null;
  }

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

  // Ідемпотентність за 7 днів — той самий (нормалізований) запит не плодить дублі-чернетки.
  // 2026-09-09: findFirst() без фільтра по question брав ДОВІЛЬНИЙ (перший-зустрінутий) рядок з
  // джерела from_dialog і звіряв ЛИШЕ його — дублі проходили повз, щойно в 7-денному вікні було
  // більше одного чернеткового запису (а це майже завжди так). Тепер перевіряємо ВЕСЬ недавній набір.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const recent = await db.knowledgeEntry.findMany({
    where: { tenantId: req.tenant.id, source: 'from_dialog', createdAt: { gte: sevenDaysAgo } },
    select: { id: true, question: true, answer: true, tags: true, scope: true, categoryId: true, supplierId: true, productId: true, priority: true, isActive: true, source: true, createdBy: true, sessionId: true, createdAt: true, updatedAt: true, kind: true, tenantId: true },
  });
  const dup = recent.find((r) => String(r.question || '').trim().toLowerCase().replace(/\s+/g, ' ') === normalized) || null;
  if (dup) return res.json({ ok: true, data: dup, deduped: true });

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
    },
  });
  res.status(201).json({ ok: true, data: entry });
}));

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
