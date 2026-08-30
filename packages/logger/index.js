// Winston logger + sanitize-обгортка — той самий патерн, що й у platform/packages/logger.
// Ключі apiKey/token/password/secret/authorization ніколи не потрапляють у логи як є.
const winston = require('winston');

const SECRET_KEY_PATTERN = /(apiKey|token|password|secret|authorization)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : sanitize(val);
    }
    return out;
  }
  return value;
}

const isProd = process.env.NODE_ENV === 'production';

const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
    isProd ? winston.format.json() : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  ),
  transports: [new winston.transports.Console()],
});

module.exports = {
  error: (message, meta = {}) => winstonLogger.error(message, sanitize(meta)),
  warn: (message, meta = {}) => winstonLogger.warn(message, sanitize(meta)),
  info: (message, meta = {}) => winstonLogger.info(message, sanitize(meta)),
  debug: (message, meta = {}) => winstonLogger.debug(message, sanitize(meta)),
};
