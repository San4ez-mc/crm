'use strict';
// 2026-11-14 (Edits Олексія 10.11: «замовлення з органіки привʼязуються до реклами, яку давно не рекламую»).
// Знімає привʼязку до реклами з карток/замовлень, де оголошення на момент першого/останнього дотику не крутилось
// (немає витрат за 3 дні до розмови, не «активне», не щойно створене) — lib/adLiveness.js. Такі розмови стають «органікою».
//   node scripts/reattribute-organic-2026-11-14.js [--tenant=goverla_shop] [--since=2026-09-01]          — лише показати
//   node scripts/reattribute-organic-2026-11-14.js ... --apply --backup=/root/reattribute_backup.json    — записати (старі значення — у файл)
// Нічого не видаляє: лише обнуляє firstTouchAdId/firstTouchAt та lastTouchAdId/lastTouchAt. Повернути можна з файлу резерву (--restore=файл).
const fs = require('node:fs');
const path = require('node:path');
const CRM = process.env.CRM_DIR || path.join(__dirname, '..');
require(path.join(CRM, 'node_modules/dotenv')).config({ path: path.join(CRM, '.env') });
const { db } = require(path.join(CRM, 'packages/db'));
const { adWasLive } = require(path.join(CRM, 'apps/api/src/lib/adLiveness'));

const arg = (n, d) => ((process.argv.find((a) => a.startsWith('--' + n + '=')) || '').slice(n.length + 3)) || d;
const APPLY = process.argv.includes('--apply');

(async () => {
  const restore = arg('restore', '');
  if (restore) {
    const rows = JSON.parse(fs.readFileSync(restore, 'utf8'));
    for (const r of rows) await db.order.update({ where: { id: r.id }, data: { firstTouchAdId: r.firstTouchAdId, firstTouchAt: r.firstTouchAt ? new Date(r.firstTouchAt) : null, lastTouchAdId: r.lastTouchAdId, lastTouchAt: r.lastTouchAt ? new Date(r.lastTouchAt) : null } });
    console.log('Відновлено', rows.length);
    return;
  }
  const tenant = await db.tenant.findFirst({ where: { name: arg('tenant', 'goverla_shop') }, select: { id: true, name: true } });
  if (!tenant) throw new Error('Магазин не знайдено');
  const since = new Date(arg('since', '2026-09-01') + 'T00:00:00Z');
  const orders = await db.order.findMany({
    where: { tenantId: tenant.id, deletedAt: null, createdAt: { gte: since }, OR: [{ firstTouchAdId: { not: null } }, { lastTouchAdId: { not: null } }] },
    select: { id: true, createdAt: true, placedAt: true, buyerId: true, stage: { select: { countsAsOrder: true } }, firstTouchAdId: true, firstTouchAt: true, lastTouchAdId: true, lastTouchAt: true },
  });
  const adIds = [...new Set(orders.flatMap((o) => [o.firstTouchAdId, o.lastTouchAdId]).filter(Boolean))];
  const ads = new Map((await db.ad.findMany({ where: { id: { in: adIds } } })).map((a) => [a.id, a]));
  const cache = new Map();
  const live = async (adId, at) => {
    const key = adId + '|' + (at ? new Date(at).toISOString().slice(0, 10) : 'now');
    if (!cache.has(key)) cache.set(key, await adWasLive(ads.get(adId), at));
    return cache.get(key);
  };
  const changes = [];
  for (const o of orders) {
    const at1 = o.firstTouchAt || o.createdAt; const at2 = o.lastTouchAt || at1;
    const dropFirst = o.firstTouchAdId && !(await live(o.firstTouchAdId, at1));
    const dropLast = o.lastTouchAdId && !(await live(o.lastTouchAdId, at2));
    if (dropFirst || dropLast) changes.push({ o, dropFirst: !!dropFirst, dropLast: !!dropLast });
  }
  const placed = changes.filter((c) => c.o.buyerId && !(c.o.stage && c.o.stage.countsAsOrder === false));
  const byAd = new Map();
  for (const c of changes) {
    const id = c.dropFirst ? c.o.firstTouchAdId : c.o.lastTouchAdId;
    const r = byAd.get(id) || { cards: 0, placed: 0 }; r.cards += 1; if (c.o.buyerId && !(c.o.stage && c.o.stage.countsAsOrder === false)) r.placed += 1; byAd.set(id, r);
  }
  console.log(`«${tenant.name}» з ${arg('since', '2026-09-01')}: карток/замовлень з рекламою ${orders.length}; стали б органікою ${changes.length} (з них оформлених замовлень ${placed.length})`);
  for (const [id, r] of [...byAd.entries()].sort((a, b) => b[1].placed - a[1].placed || b[1].cards - a[1].cards).slice(0, 25)) {
    const ad = ads.get(id);
    const last = await db.adSpendDaily.findFirst({ where: { adId: id, amount: { gt: 0 } }, orderBy: { date: 'desc' }, select: { date: true } });
    console.log(`  ${String(ad && (ad.name || ad.externalId) || id).slice(0, 50).padEnd(50)} картки ${String(r.cards).padStart(3)}, замовлення ${String(r.placed).padStart(3)}, остання реклама ${last ? last.date.toISOString().slice(0, 10) : 'ніколи'}`);
  }
  if (!APPLY) { console.log('\nСухий прогін. Додайте --apply --backup=<файл>.'); return; }
  const backup = arg('backup', '');
  if (!backup) throw new Error('Потрібен --backup=<файл> для резерву старих значень');
  fs.writeFileSync(backup, JSON.stringify(changes.map((c) => ({ id: c.o.id, firstTouchAdId: c.o.firstTouchAdId, firstTouchAt: c.o.firstTouchAt, lastTouchAdId: c.o.lastTouchAdId, lastTouchAt: c.o.lastTouchAt })), null, 1));
  for (const c of changes) {
    await db.order.update({ where: { id: c.o.id }, data: { ...(c.dropFirst ? { firstTouchAdId: null, firstTouchAt: null } : {}), ...(c.dropLast ? { lastTouchAdId: null, lastTouchAt: null } : {}) } });
  }
  console.log('Застосовано:', changes.length, '· резерв:', backup);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); }).finally(() => db.$disconnect());
