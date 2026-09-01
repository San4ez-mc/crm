// §4.5 Category — CRUD, tenant-scoped.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError, ConflictError } = require('@crm/errors');

const router = express.Router();

router.get('/categories', asyncHandler(async (req, res) => {
  const categories = await db.category.findMany({
    where: { tenantId: req.tenant.id },
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ ok: true, data: categories.map((c) => ({ ...c, productsCount: c._count.products, _count: undefined })) });
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const { name, description, aiInstructions, requiredParams } = req.body || {};
  if (!name || !String(name).trim()) throw new ValidationError('name обовʼязкове');
  const category = await db.category.create({
    data: { tenantId: req.tenant.id, name: String(name).trim(), description: description || null, aiInstructions: aiInstructions || null, requiredParams: Array.isArray(requiredParams) ? requiredParams : [] },
  });
  res.status(201).json({ ok: true, data: category });
}));

router.get('/categories/:id', asyncHandler(async (req, res) => {
  const category = await db.category.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!category) throw new NotFoundError('Category', req.params.id);
  res.json({ ok: true, data: category });
}));

router.patch('/categories/:id', asyncHandler(async (req, res) => {
  const existing = await db.category.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Category', req.params.id);
  const { name, description, aiInstructions, requiredParams } = req.body || {};
  const category = await db.category.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(aiInstructions !== undefined ? { aiInstructions } : {}),
      ...(requiredParams !== undefined ? { requiredParams: Array.isArray(requiredParams) ? requiredParams : [] } : {}),
    },
  });
  res.json({ ok: true, data: category });
}));

router.delete('/categories/:id', asyncHandler(async (req, res) => {
  const existing = await db.category.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { _count: { select: { products: true } } } });
  if (!existing) throw new NotFoundError('Category', req.params.id);
  if (existing._count.products > 0) throw new ConflictError('Спершу перенесіть товари з цієї категорії', { productsCount: existing._count.products });
  await db.category.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

module.exports = router;
