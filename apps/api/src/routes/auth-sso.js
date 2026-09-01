// SSO-логін для веб-адмінки + контракт SSO-панелі (GET .../projects, .../pages).
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { AuthError, ForbiddenError } = require('@crm/errors');
const ssoClient = require('../lib/ssoClient');

const router = express.Router();

const SECURE_COOKIES = String(process.env.SSO_REDIRECT_URI || '').startsWith('https://');
const SESSION_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 30 * 24 * 3600 * 1000 };

// Крок 1: адмінка редіректить сюди → далі на SSO /authorize.
router.get('/auth/sso/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('crm_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 600_000 });
  res.redirect(ssoClient.authorizeUrl(state));
});

// Крок 2: SSO повертає сюди з ?code&state.
// На будь-якій помилці — редірект назад на /login?sso=<код> (як у flows), а
// не сирий JSON-error: юзер має побачити ту саму картку логіну з поясненням,
// а не впасти на API-відповідь.
router.get('/auth/callback', asyncHandler(async (req, res) => {
  const { code, state } = req.query;
  const expectedState = req.cookies?.crm_oauth_state;
  res.cookie('crm_oauth_state', '', { maxAge: 0 });
  const adminBase = process.env.ADMIN_BASE_URL || 'http://localhost:5173';
  if (!code || !state || state !== expectedState) {
    return void res.redirect(`${adminBase}/login?sso=state`);
  }
  let tokenRes;
  try {
    tokenRes = await ssoClient.exchangeCodeForToken(String(code));
  } catch {
    return void res.redirect(`${adminBase}/login?sso=exchange`);
  }
  if (!tokenRes?.access_token) return void res.redirect(`${adminBase}/login?sso=exchange`);
  res.cookie('crm_session', tokenRes.access_token, SESSION_COOKIE_OPTS);
  res.redirect(adminBase);
}));

router.post('/auth/logout', (req, res) => {
  res.cookie('crm_session', '', { maxAge: 0 });
  res.json({ ok: true });
});

router.get('/me', asyncHandler(async (req, res) => {
  const token = req.cookies?.crm_session;
  if (!token) throw new AuthError('Не автентифіковано');
  const identity = await ssoClient.introspect(token);
  if (!identity.active) throw new AuthError('Сесія недійсна');
  const perms = await ssoClient.getPermissions(identity.sub);
  const tenants = perms.role === 'superadmin'
    ? await db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : await db.tenant.findMany({ where: { id: { in: perms.projectIds } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  res.json({ ok: true, data: { user: { id: identity.sub, email: identity.email, name: identity.name }, role: perms.role, tenants } });
}));

// ── Контракт SSO-панелі (server-to-server, x-sso-secret) ──────────────────
function requireSsoSecret(req, res, next) {
  const secret = req.header('x-sso-secret') || '';
  if (!process.env.SSO_CLIENT_SECRET || secret !== process.env.SSO_CLIENT_SECRET) {
    throw new ForbiddenError('invalid x-sso-secret');
  }
  next();
}

router.get('/api/auth/sso/projects', requireSsoSecret, asyncHandler(async (req, res) => {
  const tenants = await db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });
  res.json({ projects: tenants.map((t) => ({ id: t.id, name: t.name })) });
}));

// Меню §3 ТЗ — статичний список пунктів для гранулярного per-page доступу в SSO-панелі.
const PAGES = [
  { id: 'products', label: 'Товари' },
  { id: 'sets', label: 'Комплекти' },
  { id: 'categories', label: 'Категорії' },
  { id: 'suppliers', label: 'Постачальники' },
  { id: 'pipelines', label: 'Воронки' },
  { id: 'orders', label: 'Замовлення' },
  { id: 'buyers', label: 'Покупці' },
  { id: 'returns', label: 'Повернення/обміни' },
  { id: 'analytics', label: 'Дашборд аналітики' },
  { id: 'daily-analytics', label: 'Щоденна аналітика' },
  { id: 'ads', label: 'Оголошення' },
  { id: 'ad-spend', label: 'Рекламні витрати' },
  { id: 'payments', label: 'Журнал платежів' },
  { id: 'product-expenses', label: 'Витрати по товару' },
  { id: 'settings-general', label: 'Налаштування — Загальні' },
  { id: 'automations', label: 'Автоматизації' },
];

router.get('/api/auth/sso/pages', requireSsoSecret, (req, res) => {
  res.json({ pages: PAGES });
});

module.exports = router;
