// Fineko CRM API — Express, той самий стиль конвенцій що platform (CommonJS, packages/*).
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') }); // корінь монорепо — PM2 сам .env не читає
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const { db } = require('@crm/db');
const logger = require('@crm/logger');

const errorHandler = require('./middleware/errorHandler');
const asyncHandler = require('./middleware/asyncHandler');
const { resolveTenant } = require('./middleware/resolveTenant');

const authSsoRouter = require('./routes/auth-sso');
const mcpRouter = require('./routes/mcp');
const mcpEditRouter = require('./routes/mcp-edit');
const tenantsAdminRouter = require('./routes/tenants-admin');
const tenantSettingsRouter = require('./routes/tenant-settings');
const categoriesRouter = require('./routes/categories');
const suppliersRouter = require('./routes/suppliers');
const productsRouter = require('./routes/products');
const buyersRouter = require('./routes/buyers');
const pipelinesRouter = require('./routes/pipelines');
const ordersRouter = require('./routes/orders');
const returnsRouter = require('./routes/returns');
const paymentsRouter = require('./routes/payments');
const adsRouter = require('./routes/ads');
const productExpensesRouter = require('./routes/product-expenses');
const analyticsRouter = require('./routes/analytics');
const uploadsRouter = require('./routes/uploads');
const fopsRouter = require('./routes/fops');
const tenantSecretsRouter = require('./routes/tenant-secrets');
const funnelEventsRouter = require('./routes/funnel-events');

const app = express();
const PORT = Number(process.env.PORT || 4700);

// CSP + базові security-заголовки (знайдено security-аудитом 2026-08-30 — не було зовсім).
// crossOriginResourcePolicy: false — /uploads мають бути читабельні з інших *.fineko.space
// доменів (адмінка на окремому origin у dev, і потенційно з домену воронки в проді).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // React inline style="" атрибути
      imgSrc: ["'self'", 'data:', 'https:'], // фото товарів — частина лишається на зовнішньому KeyCRM CDN (див. migrate-keycrm.js)
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: false,
}));

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));
app.use('/uploads', express.static(path.join(__dirname, '../../../uploads')));

app.get('/health', asyncHandler(async (req, res) => {
  const tenants = await db.tenant.count().catch(() => -1);
  res.json({ ok: true, service: 'fineko-crm-api', tenants });
}));

// SSO-логін адмінки + контракт SSO-панелі (свої власні перевірки авторизації всередині).
app.use(authSsoRouter);

// MCP (§5, §6 CLAUDE.md) — власна авторизація (Bearer MCP_SECRET), крос-тенантно.
app.use('/api', mcpRouter, mcpEditRouter);

// Онбординг нових tenant — окремо, superadmin-only, без прив'язки до конкретного tenantId.
app.use('/api', tenantsAdminRouter);

// Бізнес-роути — усі під спільним resolveTenant (Bearer tenant.apiKey АБО SSO-сесія+tenantId).
app.use('/api', resolveTenant,
  tenantSettingsRouter,
  categoriesRouter,
  suppliersRouter,
  productsRouter,
  buyersRouter,
  pipelinesRouter,
  ordersRouter,
  returnsRouter,
  paymentsRouter,
  adsRouter,
  productExpensesRouter,
  analyticsRouter,
  uploadsRouter,
  fopsRouter,
  tenantSecretsRouter,
  funnelEventsRouter,
);

// Продакшн: зібраний admin SPA (yarn build:admin → public/admin) роздається тим самим
// процесом, щоб nginx/сервер потребував проксі лише на один порт (той самий підхід, що platform).
// У dev-режимі admin піднятий окремо на Vite (5173) — цей блок просто нічого не знаходить і падає в 404 нижче.
const ADMIN_DIST = path.join(__dirname, '../../../public/admin');
app.use(express.static(ADMIN_DIST));
app.get('*', (req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/auth') || req.path === '/me' || req.path === '/health') return next();
  res.sendFile(path.join(ADMIN_DIST, 'index.html'), (err) => { if (err) next(); });
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` } });
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Fineko CRM API listening on :${PORT}`);
});
