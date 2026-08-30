// Єдина точка авторизації бізнес-роутів. Два шляхи, як описано в CLAUDE.md §5:
//   1) Authorization: Bearer <tenant.apiKey>  — воронка / MCP / Flows-автоматизації, повний доступ.
//   2) crm_session cookie (SSO access_token)  — веб-адмінка; tenant береться з ?tenantId=
//      або :tenantId у шляху, права перевіряються через SSO /oauth/permissions.
const { db } = require('@crm/db');
const { AuthError, ForbiddenError, NotFoundError } = require('@crm/errors');
const asyncHandler = require('./asyncHandler');
const { bearer } = require('./tenantApiKeyAuth');
const ssoClient = require('../lib/ssoClient');

const resolveTenant = asyncHandler(async (req, res, next) => {
  const apiKey = bearer(req);
  if (apiKey) {
    const tenant = await db.tenant.findUnique({ where: { apiKey } });
    if (!tenant) throw new AuthError('Invalid tenant apiKey');
    req.tenant = tenant;
    req.authMethod = 'tenant-api-key';
    req.access = { role: 'superadmin', canEdit: true }; // funnel/MCP has full rights within its own tenant
    return next();
  }

  const token = req.cookies?.crm_session;
  if (!token) throw new AuthError('Не автентифіковано — увійдіть через SSO');
  const identity = await ssoClient.introspect(token);
  if (!identity.active) throw new AuthError('Сесія недійсна або протерміновано');
  req.user = { id: identity.sub, email: identity.email, name: identity.name };

  const tenantId = req.params.tenantId || req.query.tenantId;
  if (!tenantId) throw new ForbiddenError('tenantId обовʼязковий (query або :tenantId)');

  const perms = await ssoClient.getPermissions(identity.sub);
  const allowed = perms.role === 'superadmin' || (perms.role === 'user' && perms.projectIds.includes(tenantId));
  if (!allowed) throw new ForbiddenError('Немає доступу до цього магазину');

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new NotFoundError('Tenant', tenantId);

  req.tenant = tenant;
  req.authMethod = 'sso-session';
  req.access = { role: perms.role, canEdit: perms.canEdit !== false };
  next();
});

module.exports = { resolveTenant };
