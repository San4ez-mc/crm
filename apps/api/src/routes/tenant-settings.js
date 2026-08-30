// §9.16 Налаштування — Загальні: назва магазину, API-ключ (показати/перегенерувати).
// Працює в межах req.tenant, встановленого resolveTenant — без окремого :id в шляху.
const express = require('express');
const crypto = require('node:crypto');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError } = require('@crm/errors');

const router = express.Router();

router.get('/tenant', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { id: req.tenant.id, name: req.tenant.name, apiKey: req.tenant.apiKey, ssoOrgId: req.tenant.ssoOrgId } });
}));

router.patch('/tenant', asyncHandler(async (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) throw new ValidationError('name обовʼязкове');
  const tenant = await db.tenant.update({ where: { id: req.tenant.id }, data: { name: String(name).trim() } });
  res.json({ ok: true, data: { id: tenant.id, name: tenant.name } });
}));

// Перегенерація — стару воронку/MCP-конектор доведеться оновити новим ключем (попередження в UI).
router.post('/tenant/regenerate-key', asyncHandler(async (req, res) => {
  const tenant = await db.tenant.update({ where: { id: req.tenant.id }, data: { apiKey: crypto.randomUUID() } });
  res.json({ ok: true, data: { id: tenant.id, apiKey: tenant.apiKey } });
}));

module.exports = router;
