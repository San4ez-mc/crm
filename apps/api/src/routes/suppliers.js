// §4.4 Supplier — CRUD, tenant-scoped.
const express = require('express');
const { db } = require('@crm/db');
const asyncHandler = require('../middleware/asyncHandler');
const { ValidationError, NotFoundError, ConflictError } = require('@crm/errors');

const router = express.Router();

router.get('/suppliers', asyncHandler(async (req, res) => {
  const suppliers = await db.supplier.findMany({
    where: { tenantId: req.tenant.id },
    include: { _count: { select: { products: true } } },
    orderBy: { name: 'asc' },
  });
  res.json({ ok: true, data: suppliers.map((s) => ({ ...s, productsCount: s._count.products, _count: undefined })) });
}));

router.post('/suppliers', asyncHandler(async (req, res) => {
  const { name, mechanism, contactInfo, description, aiNotes, website, telegramGroupId, loginUsername, loginPassword, apiConfig, orderRecipe } = req.body || {};
  if (!name || !String(name).trim()) throw new ValidationError('name обовʼязкове');
  const supplier = await db.supplier.create({
    data: {
      tenantId: req.tenant.id,
      name: String(name).trim(),
      mechanism: mechanism || null,
      contactInfo: contactInfo || null,
      description: description || null,
      aiNotes: aiNotes || null,
      website: website || null,
      telegramGroupId: telegramGroupId || null,
      loginUsername: loginUsername || null,
      loginPassword: loginPassword || null,
      apiConfig: apiConfig && typeof apiConfig === 'object' && !Array.isArray(apiConfig) ? apiConfig : undefined,
      orderRecipe: orderRecipe || null,
    },
  });
  res.status(201).json({ ok: true, data: supplier });
}));

router.get('/suppliers/:id', asyncHandler(async (req, res) => {
  const supplier = await db.supplier.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!supplier) throw new NotFoundError('Supplier', req.params.id);
  res.json({ ok: true, data: supplier });
}));

router.patch('/suppliers/:id', asyncHandler(async (req, res) => {
  const existing = await db.supplier.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id } });
  if (!existing) throw new NotFoundError('Supplier', req.params.id);
  const { name, mechanism, contactInfo, description, aiNotes, website, telegramGroupId, loginUsername, loginPassword, apiConfig, orderRecipe } = req.body || {};
  if (apiConfig !== undefined && apiConfig !== null && (typeof apiConfig !== 'object' || Array.isArray(apiConfig))) {
    throw new ValidationError('apiConfig має бути обʼєктом {[назва]: значення} або null');
  }
  const supplier = await db.supplier.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(mechanism !== undefined ? { mechanism } : {}),
      ...(contactInfo !== undefined ? { contactInfo } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(aiNotes !== undefined ? { aiNotes } : {}),
      ...(website !== undefined ? { website } : {}),
      ...(telegramGroupId !== undefined ? { telegramGroupId } : {}),
      ...(loginUsername !== undefined ? { loginUsername } : {}),
      ...(loginPassword !== undefined ? { loginPassword } : {}),
      ...(apiConfig !== undefined ? { apiConfig } : {}),
      ...(orderRecipe !== undefined ? { orderRecipe } : {}),
    },
  });
  res.json({ ok: true, data: supplier });
}));

router.delete('/suppliers/:id', asyncHandler(async (req, res) => {
  const existing = await db.supplier.findFirst({ where: { id: req.params.id, tenantId: req.tenant.id }, include: { _count: { select: { products: true } } } });
  if (!existing) throw new NotFoundError('Supplier', req.params.id);
  if (existing._count.products > 0) throw new ConflictError('Спершу відв\'яжіть товари від цього постачальника', { productsCount: existing._count.products });
  await db.supplier.delete({ where: { id: existing.id } });
  res.json({ ok: true, data: { id: existing.id, deleted: true } });
}));

module.exports = router;
