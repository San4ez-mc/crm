// Ієрархія помилок — той самий патерн, що platform/packages/errors.
// errorHandler у apps/api мапить ці класи на HTTP-статуси.
class CrmError extends Error {
  constructor(message, code = 'CRM_ERROR', context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

class AuthError extends CrmError {
  constructor(message = 'Unauthorized', context = {}) {
    super(message, 'AUTH_ERROR', context);
  }
}

class ForbiddenError extends CrmError {
  constructor(message = 'Forbidden', context = {}) {
    super(message, 'FORBIDDEN', context);
  }
}

class NotFoundError extends CrmError {
  constructor(resource = 'Resource', id = '') {
    super(`${resource}${id ? ` (${id})` : ''} not found`, 'NOT_FOUND', { resource, id });
  }
}

class ValidationError extends CrmError {
  constructor(message = 'Validation failed', context = {}) {
    super(message, 'VALIDATION_ERROR', context);
  }
}

class ConflictError extends CrmError {
  constructor(message = 'Conflict', context = {}) {
    super(message, 'CONFLICT', context);
  }
}

module.exports = { CrmError, AuthError, ForbiddenError, NotFoundError, ValidationError, ConflictError };
