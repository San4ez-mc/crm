// 2026-10-26 (Edits c4fc2dcd/15b533ae): дата оформлення (placedAt) і «Хто оформив» (placedBy) для наявних замовлень.
// Міграція ставить placedAt = createdAt; тут — уточнення для замовлень із розмов (createdAt там = початок розмови):
//   перша оплата / подія «Замовлення прийняте» / «…оформлене в постачальника» / «Очікуємо дані та оплату» (найраніша, не раніше createdAt).
// placedBy: менеджер із коментаря EasyDrop («EasyDrop …: менеджер Вікторія»), інакше «Бот» для замовлень із розмов.
// Без --apply — лише підсумок. Запуск: node scripts/backfill-placed-at.js [--apply] [--tenant goverla_shop]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../packages/db');

const APPLY = process.argv.includes('--apply');
const ti = process.argv.indexOf('--tenant');
const TENANT = ti > 0 ? process.argv[ti + 1] : null;
const PLACE_STAGES = ['Замовлення прийняте', 'Замовлення оформлене в постачальника', 'Очікуємо дані та оплату'];

(async () => {
  const tenants = await db.tenant.findMany({ where: TENANT ? { name: TENANT } : {}, select: { id: true, name: true } });
  for (const t of tenants) {
    const orders = await db.order.findMany({
      where: { tenantId: t.id, buyerId: { not: null } },
      select: { id: true, createdAt: true, placedAt: true, placedBy: true, funnelSessionId: true, managerComment: true, payments: { select: { createdAt: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    });
    let moved = 0, who = 0;
    for (const o of orders) {
      const data = {};
      if (o.funnelSessionId) {
        const ev = await db.funnelEvent.findMany({ where: { tenantId: t.id, sessionId: o.funnelSessionId, stageName: { in: PLACE_STAGES } }, select: { occurredAt: true } });
        const cands = ev.map((e) => e.occurredAt).concat(o.payments.map((p) => p.createdAt)).filter((d) => d && d.getTime() >= o.createdAt.getTime() - 60e3);
        if (cands.length) {
          const at = new Date(Math.min(...cands.map((d) => d.getTime())));
          if (!o.placedAt || Math.abs(at - o.placedAt) > 60e3) { data.placedAt = at; moved++; }
        }
      }
      if (!o.placedBy) {
        const m = String(o.managerComment || '').match(/EasyDrop[^\n]*?менеджер\s+([^;\n]+)/i);
        const by = m && m[1].trim() && m[1].trim() !== '—' ? m[1].trim() : (o.funnelSessionId ? 'Бот' : null);
        if (by) { data.placedBy = by.slice(0, 80); who++; }
      }
      if (APPLY && Object.keys(data).length) await db.order.update({ where: { id: o.id }, data });
    }
    console.log(t.name, '| замовлень', orders.length, '| дата оформлення уточнена', moved, '| «хто оформив»', who, APPLY ? '(записано)' : '(план)');
  }
  await db.$disconnect();
})().catch((e) => { console.error('ПОМИЛКА', e.message); process.exit(1); });
