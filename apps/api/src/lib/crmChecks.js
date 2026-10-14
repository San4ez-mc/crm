// «Перевірити в CRM» (CrmCheck, 2026-10-14) — спільна логіка для REST (routes/crm-checks.js) і MCP (apps/mcp/src/tools.js),
// щоб правила статусів (відповідь → answered, закриття → closed, повторне відкриття) жили в одному місці.
const { db } = require('@crm/db');
const { ValidationError, NotFoundError } = require('@crm/errors');

const PRIORITIES = ['high', 'normal'];
const STATUSES = ['open', 'answered', 'closed'];
const STATUS_ORDER = { open: 0, answered: 1, closed: 2 };

function cleanStr(v, max = 20000) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// [{label,url}] — лише http(s)-посилання; рядок без label теж приймаємо.
function cleanLinks(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new ValidationError('sessionLinks має бути масивом {label,url}');
  return v
    .map((l) => (typeof l === 'string' ? { label: '', url: l } : { label: String(l?.label || '').slice(0, 300), url: String(l?.url || '').trim() }))
    .filter((l) => /^https?:\/\//i.test(l.url))
    .slice(0, 50);
}

// Відносний шлях адмінки (/products?search=…) або повний http(s)-URL; інше (javascript: тощо) — відкидаємо.
function cleanPageUrl(v) {
  const s = cleanStr(v, 1000);
  if (s === undefined || s === null) return s;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  throw new ValidationError('pageUrl: відносний шлях адмінки (/products?search=…) або http(s)-посилання');
}

/** Список: за замовчуванням спершу відкриті, далі з відповіддю, далі закриті; всередині — high першими, новіші вище. */
async function listChecks(tenantId, { status } = {}) {
  const statuses = status ? String(status).split(',').map((s) => s.trim()).filter((s) => STATUSES.includes(s)) : [];
  const items = await db.crmCheck.findMany({
    where: { tenantId, ...(statuses.length ? { status: { in: statuses } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  items.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)
    || (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
    || new Date(b.createdAt) - new Date(a.createdAt));
  const counts = { open: 0, answered: 0, closed: 0 };
  for (const g of await db.crmCheck.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } })) counts[g.status] = g._count._all;
  return { items, counts };
}

async function getCheck(tenantId, id) {
  const check = await db.crmCheck.findFirst({ where: { id: String(id), tenantId } });
  if (!check) throw new NotFoundError('CrmCheck', id);
  return check;
}

async function createCheck(tenantId, b = {}, { actor } = {}) {
  const title = cleanStr(b.title, 300);
  if (!title) throw new ValidationError('title обовʼязковий');
  const priority = b.priority === undefined ? 'normal' : String(b.priority);
  if (!PRIORITIES.includes(priority)) throw new ValidationError(`priority: ${PRIORITIES.join(' | ')}`);
  return db.crmCheck.create({
    data: {
      tenantId,
      title,
      page: cleanStr(b.page, 200) ?? null,
      pageUrl: cleanPageUrl(b.pageUrl) ?? null,
      details: cleanStr(b.details) ?? null,
      sessionLinks: cleanLinks(b.sessionLinks) ?? [],
      priority,
      createdBy: cleanStr(b.createdBy, 200) ?? actor ?? null,
      source: cleanStr(b.source, 300) ?? null,
    },
  });
}

/**
 * Часткове оновлення. answer (непорожній) → status answered + answeredAt/By; status closed → closedAt/By;
 * status open (повторне відкриття) → знімає closedAt/By. actor — email із SSO-сесії або body.actor/'bot' для ключа магазину.
 */
async function updateCheck(tenantId, id, b = {}, { actor } = {}) {
  const existing = await getCheck(tenantId, id);
  const who = actor || cleanStr(b.actor, 200) || 'bot';
  const data = {};
  if (b.title !== undefined) { const t = cleanStr(b.title, 300); if (!t) throw new ValidationError('title не може бути порожнім'); data.title = t; }
  if (b.page !== undefined) data.page = cleanStr(b.page, 200);
  if (b.pageUrl !== undefined) data.pageUrl = cleanPageUrl(b.pageUrl);
  if (b.details !== undefined) data.details = cleanStr(b.details);
  if (b.sessionLinks !== undefined) data.sessionLinks = cleanLinks(b.sessionLinks);
  if (b.source !== undefined) data.source = cleanStr(b.source, 300);
  if (b.priority !== undefined) { if (!PRIORITIES.includes(String(b.priority))) throw new ValidationError(`priority: ${PRIORITIES.join(' | ')}`); data.priority = String(b.priority); }

  let status = b.status !== undefined ? String(b.status) : undefined;
  if (status !== undefined && !STATUSES.includes(status)) throw new ValidationError(`status: ${STATUSES.join(' | ')}`);

  if (b.answer !== undefined) {
    const answer = cleanStr(b.answer);
    data.answer = answer;
    if (answer && answer !== existing.answer) {
      data.answeredAt = new Date();
      data.answeredBy = who;
      if (status === undefined && existing.status === 'open') status = 'answered';
    }
  }
  if (status !== undefined && status !== existing.status) {
    data.status = status;
    if (status === 'closed') { data.closedAt = new Date(); data.closedBy = who; }
    else { data.closedAt = null; data.closedBy = null; }
  }
  return db.crmCheck.update({ where: { id: existing.id }, data });
}

module.exports = { PRIORITIES, STATUSES, listChecks, getCheck, createCheck, updateCheck };
