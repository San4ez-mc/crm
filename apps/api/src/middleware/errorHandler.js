// Єдиний error-middleware — той самий патерн, що platform/apps/api/src/middleware/errorHandler.js.
// Відповідь завжди { ok:false, error:{code,message,context?} }.
const { AuthError, ForbiddenError, NotFoundError, ValidationError, ConflictError, CrmError } = require('@crm/errors');
const logger = require('@crm/logger');

module.exports = function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof AuthError) {
    return res.status(401).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  if (err instanceof ForbiddenError) {
    return res.status(403).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  if (err instanceof NotFoundError) {
    return res.status(404).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({ ok: false, error: { code: err.code, message: err.message, context: err.context } });
  }
  if (err instanceof ConflictError) {
    return res.status(409).json({ ok: false, error: { code: err.code, message: err.message, context: err.context } });
  }
  if (err instanceof CrmError) {
    logger.error('CRM error', { message: err.message, code: err.code, context: err.context });
    return res.status(500).json({ ok: false, error: { code: err.code, message: err.message } });
  }
  // Prisma unique-constraint тощо
  if (err && err.code === 'P2002') {
    return res.status(409).json({ ok: false, error: { code: 'CONFLICT', message: 'Duplicate value', context: { fields: err.meta?.target } } });
  }
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
