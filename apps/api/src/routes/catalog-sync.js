// Налаштування → Загальні → «Синхронізація каталогу»: з якого магазину в цей переносити товари (lib/catalogSync.js).
// Шлях /tenant/... — той самий розділ, що й решта налаштувань (закритий для менеджерів без доступу до налаштувань).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ForbiddenError, ValidationError } = require('@crm/errors');
const ssoClient = require('../lib/ssoClient');
const sync = require('../lib/catalogSync');

const router = express.Router();

// Магазини, з яких можна брати каталог: ті, до яких є доступ у людини (SSO), крім поточного. Зі «службовим» ключем магазину обирати не можна —
// ключ доводить доступ лише до свого магазину, а не до чужого.
async function accessibleSources(req) {
  if (req.authMethod !== 'sso-session') return [];
  const perms = await ssoClient.getPermissions(req.user.id);
  const where = perms.role === 'superadmin' ? { id: { not: req.tenant.id } } : { id: { in: (perms.projectIds || []).filter((id) => id !== req.tenant.id) } };
  return db.tenant.findMany({ where, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

const view = (cfg) => cfg && ({
  sourceTenantId: cfg.sourceTenantId, source: cfg.source, enabled: cfg.enabled, syncCosts: cfg.syncCosts,
  lastRunAt: cfg.lastRunAt, lastStatus: cfg.lastStatus, lastResult: cfg.lastResult,
});

router.get('/tenant/catalog-sync', asyncHandler(async (req, res) => {
  const [cfg, sources] = await Promise.all([sync.getConfig(req.tenant.id), accessibleSources(req)]);
  res.json({ ok: true, data: { config: view(cfg), sources, canConfigure: req.authMethod === 'sso-session' } });
}));

router.put('/tenant/catalog-sync', asyncHandler(async (req, res) => {
  if (req.authMethod !== 'sso-session') throw new ForbiddenError('Налаштувати синхронізацію можна лише з адмінки під своїм входом');
  if (req.access && req.access.canEdit === false) throw new ForbiddenError('Лише перегляд — змінювати налаштування не можна');
  const { sourceTenantId, enabled, syncCosts } = req.body || {};
  if (sourceTenantId) {
    const allowed = await accessibleSources(req);
    if (!allowed.some((t) => t.id === sourceTenantId)) throw new ForbiddenError('Немає доступу до магазину-джерела');
  }
  const cfg = await sync.saveConfig(req.tenant.id, { sourceTenantId: sourceTenantId || null, enabled, syncCosts });
  res.json({ ok: true, data: { config: view(cfg) } });
}));

// Запустити зараз. dryRun: true — лише показати, скільки буде створено й оновлено, нічого не записуючи.
router.post('/tenant/catalog-sync/run', asyncHandler(async (req, res) => {
  const dryRun = !!(req.body && req.body.dryRun);
  const result = await sync.runCatalogSync(req.tenant.id, { dryRun });
  if (!result) throw new ValidationError('Не вдалось запустити синхронізацію');
  res.json({ ok: true, data: result });
}));

module.exports = router;
