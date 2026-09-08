// §9.3 "хто і коли вносив зміни" в картці товару (2026-09-08, фідбек власника).
// actorType='funnel' — запит прийшов з Bearer tenant.apiKey (воронка/MCP/Flows-автоматизація,
// resolveTenant.js виставляє req.authMethod='tenant-api-key') → actorName ЗАВЖДИ "Fineko".
// actorType='user' — SSO-сесія веб-адмінки → ім'я/email з identity, яку віддав SSO /oauth/introspect.
const { db } = require('@crm/db');
const logger = require('@crm/logger');

function actorFromReq(req) {
  if (req.authMethod === 'tenant-api-key') return { actorType: 'funnel', actorName: 'Fineko', actorUserId: null };
  const name = req.user?.name || req.user?.email || 'Користувач';
  return { actorType: 'user', actorName: name, actorUserId: req.user?.id || null };
}

// diffFields: [{key, label, kind}] — kind 'value' показує "from → to", kind 'touch' лише
// фіксує факт зміни без дампу вмісту (для великих полів: фото/масиви/довгий текст).
function buildChanges(existing, body, diffFields) {
  const changes = [];
  for (const { key, label, kind } of diffFields) {
    if (body[key] === undefined) continue;
    const from = existing[key];
    const to = body[key];
    const changed = kind === 'touch'
      ? JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)
      : String(from ?? '') !== String(to ?? '');
    if (!changed) continue;
    changes.push(kind === 'touch' ? { field: key, label, from: null, to: null, touch: true } : { field: key, label, from, to });
  }
  return changes;
}

// kind 'action' — для create/delete офера, де label вже описує ЩО сталось ("Додано варіант
// «M чорний»") і лишається просто показати його як є (без ": від → до").
function summarize(changes) {
  return changes
    .map((c) => (c.kind === 'action' ? (c.to ? `${c.label}: ${c.to}` : c.label) : c.touch ? `${c.label}: змінено` : `${c.label}: ${fmtVal(c.from)} → ${fmtVal(c.to)}`))
    .join('; ');
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'так' : 'ні';
  return String(v);
}

// Best-effort — лог не повинен валити основну операцію (створення/зміну товару), якщо тут щось піде не так.
async function logProductChange(req, productId, entity, changes) {
  if (!changes || !changes.length) return;
  try {
    const { actorType, actorName, actorUserId } = actorFromReq(req);
    await db.productChangeLog.create({
      data: { tenantId: req.tenant.id, productId, actorType, actorName, actorUserId, entity, summary: summarize(changes), changes },
    });
  } catch (e) {
    logger.warn('logProductChange: не вдалось записати лог', { productId, entity, error: e.message });
  }
}

module.exports = { actorFromReq, buildChanges, summarize, logProductChange };
