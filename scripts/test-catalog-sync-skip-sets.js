'use strict';
// Тест (без бази): синхронізація каталогу з skipSets не переносить комплекти й ховає вже перенесені (2026-11-24).
const assert = require('node:assert');
const Module = require('node:module');

const SRC = 'src-tenant'; const TGT = 'tgt-tenant';
const P = (id, sku, isSet) => ({ id, tenantId: SRC, sku, isSet, outOfStock: false, offers: [], setOf: [], productExpense: null, price: 100, name: sku });
const srcAll = [P('p1', 'A0001', false), P('p2', 'set1111', true), P('p3', 'A0002', false)];
const tgt = [
  { id: 't1', sku: 'A0001', syncSourceId: 'p1', outOfStock: false },
  { id: 't2', sku: 'set1111', syncSourceId: 'p2', outOfStock: false },
];
const calls = { productFind: [], updates: [], updateMany: [] };
const fakeDb = {
  category: { findMany: async () => [] },
  supplier: { findMany: async () => [] },
  product: {
    findMany: async (q) => {
      if (q.where.tenantId === SRC) { calls.productFind.push(q.where); return srcAll.filter((p) => !q.where.isSet === undefined ? true : (q.where.isSet === false ? !p.isSet : true)); }
      return tgt;
    },
    update: async (a) => { calls.updates.push(a); }, create: async () => ({ id: 'new' }), updateMany: async (a) => { calls.updateMany.push(a); },
  },
  $transaction: async () => {},
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@crm/db') return { db: fakeDb };
  if (request === '@prisma/client') return { Prisma: { DbNull: null } };
  if (request === '@crm/errors') return { ValidationError: Error, NotFoundError: Error, ConflictError: Error };
  return origLoad.call(this, request, ...rest);
};
const { runCatalogSync } = require('../apps/api/src/lib/catalogSync');

(async () => {
  // налаштування в «базі»
  fakeDb.catalogSync = { findUnique: async () => ({ tenantId: TGT, sourceTenantId: SRC, syncCosts: false, skipSets: true }), update: async () => {} };
  fakeDb.tenant = { findUnique: async () => ({ id: SRC }) };

  let r = await runCatalogSync(TGT, { dryRun: true });
  assert.deepStrictEqual(calls.productFind[0], { tenantId: SRC, isSet: false }, 'комплекти мають бути відфільтровані з джерела');
  assert.strictEqual(r.products.updated, 1 + 0, 'оновлюється лише A0001 (A0002 — новий)');
  assert.strictEqual(r.products.created, 1);
  assert.strictEqual(r.products.hidden, 1, 'уже перенесений комплект set1111 має сховатись');
  console.log('✓ skipSets=true: комплекти не беруться, перенесений ховається');

  fakeDb.catalogSync.findUnique = async () => ({ tenantId: TGT, sourceTenantId: SRC, syncCosts: false, skipSets: false });
  calls.productFind.length = 0;
  r = await runCatalogSync(TGT, { dryRun: true });
  assert.deepStrictEqual(calls.productFind[0], { tenantId: SRC }, 'без skipSets — як раніше, усі товари');
  assert.strictEqual(r.products.hidden, 0);
  console.log('✓ skipSets=false: поведінка без змін');
  process.exit(0);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
