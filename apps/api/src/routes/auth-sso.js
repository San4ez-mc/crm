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

// Відносний шлях цієї ж адмінки: починається з одного «/», без «//», зворотного слеша, пробілів і схеми — не відкритий редірект.
function safeNext(next) {
  return typeof next === 'string' && next.length <= 500 && next.startsWith('/') && !next.startsWith('//') && !next.includes(String.fromCharCode(92)) && !/\s/.test(next) && !next.includes('://');
}

// Крок 1: адмінка редіректить сюди → далі на SSO /authorize.
router.get('/auth/sso/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('crm_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 600_000 });
  // Куди повернути після входу (2026-10-02): посилання з Telegram «✏️ Редагувати замовлення» не має губитись,
  // якщо менеджер ще не залогінений. Лише відносний шлях цієї ж адмінки (не //host, не повний URL).
  const next = String(req.query.next || '');
  if (safeNext(next) && !next.startsWith('/login')) res.cookie('crm_login_next', next, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 600_000 });
  else res.cookie('crm_login_next', '', { maxAge: 0 });
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
  const next = String(req.cookies?.crm_login_next || '');
  res.cookie('crm_login_next', '', { maxAge: 0 });
  res.redirect(safeNext(next) ? adminBase.replace(/[/]$/, '') + next : adminBase);
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
  { id: 'knowledge', label: 'База знань' },
  { id: 'pipelines', label: 'Воронки' },
  { id: 'orders', label: 'Замовлення' },
  { id: 'buyers', label: 'Покупці' },
  { id: 'returns', label: 'Повернення/обміни' },
  { id: 'analytics', label: 'Дашборд аналітики' },
  { id: 'funnel-analytics', label: 'Воронка (конверсія)' },
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
