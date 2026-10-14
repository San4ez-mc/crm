// «Перевірити в CRM» (CrmCheck, 2026-10-14) — тікети для менеджера: що в даних CRM звірити/виправити, з посиланнями
// на розмови у Flows. Вкладка в «Базі знань» (доступ — сторінка `knowledge`, див. lib/pageAccess.js).
// SSO-сесія: answeredBy/closedBy = email користувача; ключ магазину (бот/Claude): body.actor або 'bot'.
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { listChecks, getCheck, createCheck, updateCheck } = require('../lib/crmChecks');

const router = express.Router();

function actorOf(req) {
  return req.user ? (req.user.email || req.user.name || req.user.id) : null;
}

router.get('/crm-checks', asyncHandler(async (req, res) => {
  const { items, counts } = await listChecks(req.tenant.id, { status: req.query.status });
  res.json({ ok: true, data: items, meta: { total: items.length, counts } });
}));

router.get('/crm-checks/:id', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await getCheck(req.tenant.id, req.params.id) });
}));

router.post('/crm-checks', asyncHandler(async (req, res) => {
  const check = await createCheck(req.tenant.id, req.body || {}, { actor: actorOf(req) });
  res.status(201).json({ ok: true, data: check });
}));

router.patch('/crm-checks/:id', asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await updateCheck(req.tenant.id, req.params.id, req.body || {}, { actor: actorOf(req) }) });
}));

module.exports = router;
