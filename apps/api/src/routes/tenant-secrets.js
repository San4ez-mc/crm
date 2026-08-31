// ДОПОВНЕННЯ 2026-08-31 — Ключі/секрети per-tenant (Meta/FB, Monobank тощо), щоб клієнт
// заповнював усе в одному місці (СРМ), а не в кожній воронці. tenant-scoped, той самий
// dual-auth що й в решти CRUD (SSO-сесія для адмінки, Bearer tenant.apiKey для Flows).
//
// GET /secrets — список для адмінки, значення замасковані (не світимо повний токен зайвий раз).
// GET /secrets/:id — повне значення (адмінка, коли реально відкриває форму редагування).
// GET /secrets/export — ПОВНІ значення одним обʼєктом {key: value} — це й є "місток" у Flows:
//   окрема js-нода воронки викликає цей ендпойнт (Bearer tenant.apiKey) і сама виставляє funnelKey
//   через свій MCP. Тут же фіксуємо syncedToFunnelAt, щоб в адмінці було видно "востаннє синхронізовано".
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');

const router = express.Router();

function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${'•'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

router.get('/secrets/export', asyncHandler(async (req, res) => {
  const secrets = await db.tenantSecret.findMany({ where: { tenantId: req.tenant.id } });
  await db.tenantSecret.updateMany({ where: { tenantId: req.tenant.id }, data: { syncedToFunnelAt: new Date() } });
  const out = {};
  for (const s of secrets) out[s.key] = s.value;
  res.json({ ok: true, data: out });
}));

router.get('/secrets', asyncHandler(async (req, res) => {
  const secrets = await db.tenantSecret.findMany({ where: { tenantId: req.tenant.id }, orderBy: { key: 'asc' } });
  res.json({ ok: true, data: secrets.map((s) => ({ ...s, value: s.isSecret ? mask(s.value) : s.value })) });
}));

router.post('/secrets', asyncHandler(async (req, res) => {
  const { key, label, value, isSecret } = req.body || {};
  if (!key || !String(key).trim()) throw new ValidationError('key обовʼязкове');
  if (value === undefined || value === null || value === '') throw new ValidationError('value обовʼязкове');
  const secret = await db.tenantSecret.upsert({
    where: { tenantId_key: { tenantId: req.tenant.id, key: String(key).trim() } },
    update: { value: String(value), label: label ?? undefined, isSecret: isSecret !== undefined ? !!isSecret : undefined },
    create: { tenantId: req.tenant.id, key: String(key).trim(), label: label || null, value: String(value), isSecret: isSecret !== undefined ? !!isSecret : true },
  });
  res.status(201).json({ ok: true, data: secret });
}));

router.get('/secrets/:id', asyncHandler(async (req, res) => {
  const secret = await db.tenantSecret.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!secret) throw new NotFoundError('TenantSecret', req.params.id);
  res.json({ ok: true, data: secret });
}));

router.patch('/secrets/:id', asyncHandler(async (req, res) => {
  const existing = await db.tenantSecret.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('TenantSecret', req.params.id);
  const { label, value, isSecret } = req.body || {};
  const secret = await db.tenantSecret.update({
    where: { id: existing.id },
    data: {
      ...(label !== undefined ? { label } : {}),
      ...(value !== undefined && value !== '' ? { value: String(value) } : {}),
      ...(isSecret !== undefined ? { isSecret: !!isSecret } : {}),
    },
  });
  res.json({ ok: true, data: secret });
}));

router.delete('/secrets/:id', asyncHandler(async (req, res) => {
  const existing = await db.tenantSecret.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('TenantSecret', req.params.id);
  await db.tenantSecret.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

module.exports = router;
