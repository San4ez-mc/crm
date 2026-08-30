// Fineko CRM API — Express, той самий стиль конвенцій що platform (CommonJS, packages/*).
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { db } = require('@crm/db');
const logger = require('@crm/logger');

const errorHandler = require('./middleware/errorHandler');
const asyncHandler = require('./middleware/asyncHandler');
const { resolveTenant } = require('./middleware/resolveTenant');

const authSsoRouter = require('./routes/auth-sso');
const tenantsAdminRouter = require('./routes/tenants-admin');
const tenantSettingsRouter = require('./routes/tenant-settings');
const categoriesRouter = require('./routes/categories');
const suppliersRouter = require('./routes/suppliers');
const productsRouter = require('./routes/products');
const buyersRouter = require('./routes/buyers');
const pipelinesRouter = require('./routes/pipelines');
const ordersRouter = require('./routes/orders');
const returnsRouter = require('./routes/returns');
const adsRouter = require('./routes/ads');
const productExpensesRouter = require('./routes/product-expenses');
const analyticsRouter = require('./routes/analytics');

const app = express();
const PORT = Number(process.env.PORT || 4700);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.get('/health', asyncHandler(async (req, res) => {
  const tenants = await db.tenant.count().catch(() => -1);
  res.json({ ok: true, service: 'fineko-crm-api', tenants });
}));

// SSO-логін адмінки + контракт SSO-панелі (свої власні перевірки авторизації всередині).
app.use(authSsoRouter);

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
  adsRouter,
  productExpensesRouter,
  analyticsRouter,
);

app.use((req, res) => {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `No route ${req.method} ${req.path}` } });
});

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`Fineko CRM API listening on :${PORT}`);
});
