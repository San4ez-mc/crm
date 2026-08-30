// Bearer <Tenant.apiKey> — авторизація для воронки/MCP/Flows-автоматизацій (§5, §16 CLAUDE.md).
const { db } = require('@crm/db');
const { AuthError } = require('@crm/errors');
const asyncHandler = require('./asyncHandler');

function bearer(req) {
  const header = req.header('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

/** Встановлює req.tenant за Bearer tenant.apiKey. Кидає AuthError якщо відсутній/невірний. */
const tenantApiKeyAuth = asyncHandler(async (req, res, next) => {
  const token = bearer(req);
  if (!token) throw new AuthError('Bearer <tenant.apiKey> required');
  const tenant = await db.tenant.findUnique({ where: { apiKey: token } });
  if (!tenant) throw new AuthError('Invalid tenant apiKey');
  req.tenant = tenant;
  req.authMethod = 'tenant-api-key';
  next();
});

module.exports = { tenantApiKeyAuth, bearer };
