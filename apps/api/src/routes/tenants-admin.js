// Онбординг нового магазину (Tenant) — крос-тенантна дія, доступна лише superadmin
// (роль з SSO /oauth/permissions, product='crm', НЕ прив'язана до конкретного tenantId).
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { AuthError, ForbiddenError, ValidationError } = require('@crm/errors');
const ssoClient = require('../lib/ssoClient');

const router = express.Router();

const requireSuperadmin = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.crm_session;
  if (!token) throw new AuthError('Не автентифіковано — увійдіть через SSO');
  const identity = await ssoClient.introspect(token);
  if (!identity.active) throw new AuthError('Сесія недійсна');
  const perms = await ssoClient.getPermissions(identity.sub);
  if (perms.role !== 'superadmin') throw new ForbiddenError('Потрібні права superadmin');
  req.user = { id: identity.sub, email: identity.email };
  next();
});

router.get('/tenants', requireSuperadmin, asyncHandler(async (req, res) => {
  const tenants = await db.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ ok: true, data: tenants });
}));

router.post('/tenants', requireSuperadmin, asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) throw new ValidationError('name обовʼязкове');
  const tenant = await db.tenant.create({ data: { name: String(name).trim() } });
  res.status(201).json({ ok: true, data: tenant });
}));

module.exports = router;
