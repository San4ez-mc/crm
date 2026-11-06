// 2026-11-06 (власник): початкові тарифи магазинів. goverla_shop (Олексій) — тариф 3 «З AI-продавцем» до 20.11.2026;
// демо-магазини — тариф 3 без дати закінчення і прапорець isDemo (оплата з них створює нову компанію).
// Решта магазинів (covercar_ua, goverla_landing) не чіпаємо — тариф для них власник ще не вказав.
// Без --apply — лише показує. Запуск: node scripts/set-plans.js [--apply]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../packages/db');

const APPLY = process.argv.includes('--apply');
// 20.11.2026 включно за київським часом → 23:59:59 за Києвом = 21:59:59 UTC (листопад, UTC+2)
const PLANS = [
  { name: 'goverla_shop', data: { plan: 'ai', planEndsAt: new Date('2026-11-20T21:59:59.000Z') } },
  { name: 'Fineko CRM Демо', data: { plan: 'ai', planEndsAt: null, isDemo: true } },
  { name: 'Fineko CRM Демо 2: гаджети', data: { plan: 'ai', planEndsAt: null, isDemo: true } },
];

(async () => {
  for (const p of PLANS) {
    const t = await db.tenant.findFirst({ where: { name: p.name }, select: { id: true, name: true, plan: true, planEndsAt: true, isDemo: true } });
    if (!t) { console.log(`— «${p.name}»: магазину ще нема, пропущено`); continue; }
    console.log(`«${t.name}»: тариф ${t.plan || '—'} до ${t.planEndsAt ? t.planEndsAt.toISOString() : '—'} → ${p.data.plan} до ${p.data.planEndsAt ? p.data.planEndsAt.toISOString() : 'без дати'}${p.data.isDemo ? ' (демо)' : ''}`);
    if (APPLY) await db.tenant.update({ where: { id: t.id }, data: p.data });
  }
  if (!APPLY) console.log('\nСухий прогін. Додайте --apply.');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); }).finally(() => db.$disconnect());
