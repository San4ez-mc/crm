// ДОПОВНЕННЯ 2026-08-31 — ФОП (юрособа для прийому оплат), CRUD, tenant-scoped.
// Не спільна між магазинами — кожен tenant веде свій список.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError } = require('@crm/errors');

const router = express.Router();

router.get('/fops', asyncHandler(async (req, res) => {
  const fops = await db.fop.findMany({ where: { tenantId: req.tenant.id }, orderBy: { name: 'asc' } });
  res.json({ ok: true, data: fops });
}));

router.post('/fops', asyncHandler(async (req, res) => {
  const { name, iban, taxId, monobankToken } = req.body || {};
  if (!name || !String(name).trim()) throw new ValidationError('name обовʼязкове');
  const fop = await db.fop.create({
    data: { tenantId: req.tenant.id, name: String(name).trim(), iban: iban || null, taxId: taxId || null, monobankToken: monobankToken || null },
  });
  res.status(201).json({ ok: true, data: fop });
}));

router.get('/fops/:id', asyncHandler(async (req, res) => {
  const fop = await db.fop.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!fop) throw new NotFoundError('Fop', req.params.id);
  res.json({ ok: true, data: fop });
}));

router.patch('/fops/:id', asyncHandler(async (req, res) => {
  const existing = await db.fop.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Fop', req.params.id);
  const { name, iban, taxId, monobankToken } = req.body || {};
  const fop = await db.fop.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(iban !== undefined ? { iban } : {}),
      ...(taxId !== undefined ? { taxId } : {}),
      ...(monobankToken !== undefined ? { monobankToken } : {}),
    },
  });
  res.json({ ok: true, data: fop });
}));

router.delete('/fops/:id', asyncHandler(async (req, res) => {
  const existing = await db.fop.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Fop', req.params.id);
  await db.fop.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

module.exports = router;
