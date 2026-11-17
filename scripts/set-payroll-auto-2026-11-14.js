'use strict';
// 2026-11-14 (Edits 94632d8d / 56011e69 / 33e9707d, Олексій): «Витрати на оплату праці» (вручну) замінити на автоматичний рядок
// «10% на ЗП із врахуванням відмов» і поставити його в «Очікуваний прибуток»; ручний показник прибрати.
// Що робить для магазину:
//   1) Tenant.dailyPayrollPct = 10 (або --pct=…) — відтепер оплата праці дня = % від маржі з прогнозованими відмовами;
//   2) у розкладці «Щоденної аналітики»: рядок «Витрати на оплату праці» перейменовується на «10% на ЗП із врахуванням відмов, грн» (тепер він
//      автоматичний), а власний дубль Олексія (формула «Маржа з прогнозом × 0,1») прибирається;
//   3) резерв: старі розкладка й ручні суми по днях — у файл (--backup=…). Самі ручні суми в базі не видаляються.
//   node scripts/set-payroll-auto-2026-11-14.js [--tenant=goverla_shop] [--pct=10]                       — лише показати
//   node scripts/set-payroll-auto-2026-11-14.js ... --apply --backup=/root/payroll_backup_2026-11-14.json — записати
const fs = require('node:fs');
const path = require('node:path');
const { Prisma } = require('@prisma/client');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { db } = require('../packages/db');

const arg = (n, d) => ((process.argv.find((a) => a.startsWith('--' + n + '=')) || '').slice(n.length + 3)) || d;
const APPLY = process.argv.includes('--apply');
const LABEL = '10% на ЗП із врахуванням відмов, грн';

// Власний показник Олексія «× 0,1 від маржі з прогнозом» — дубль того, що тепер рахує система.
function isOwnerDuplicate(r) {
  const f = r && r.custom && r.custom.formula;
  if (!f || r.custom.type !== 'formula') return false;
  if (f.kind === 'percent') return f.ref === 'marginTotalForecast' && Number(f.pct) === 10;
  if (f.kind === 'chain' && Array.isArray(f.terms) && f.terms.length === 2) {
    const [a, b] = f.terms; return a.ref === 'marginTotalForecast' && b.op === '×' && Number(b.num) === 0.1;
  }
  return false;
}

(async () => {
  const pct = Number(arg('pct', '10'));
  const tenant = await db.tenant.findFirst({ where: { name: arg('tenant', 'goverla_shop') }, select: { id: true, name: true, dailyPayrollPct: true, dailyLayout: true } });
  if (!tenant) throw new Error('Магазин не знайдено');
  const rows = tenant.dailyLayout && Array.isArray(tenant.dailyLayout.rows) ? tenant.dailyLayout.rows : [];
  const dup = rows.filter(isOwnerDuplicate);
  const next = rows.filter((r) => !isOwnerDuplicate(r)).map((r) => (r.id === 'payrollCosts' ? { id: 'payrollCosts', label: LABEL } : r)); // перейменований, не схований
  if (!next.some((r) => r.id === 'payrollCosts') && rows.length) next.push({ id: 'payrollCosts', label: LABEL });
  console.log(`«${tenant.name}»: відсоток ЗП ${tenant.dailyPayrollPct == null ? '—' : Number(tenant.dailyPayrollPct)} → ${pct}`);
  console.log(`розкладка: рядків ${rows.length} → ${next.length}; прибираю власні дублі: ${dup.map((r) => `«${r.label}»`).join(', ') || 'немає'}; «Витрати на оплату праці» → «${LABEL}»`);
  if (!rows.length) console.log('(розкладка порожня — вбудований рядок покаже автоматичне значення зі стандартною назвою)');
  if (!APPLY) { console.log('\nСухий прогін. Додайте --apply --backup=<файл>.'); return; }
  const backup = arg('backup', '');
  if (!backup) throw new Error('Потрібен --backup=<файл>');
  const manual = await db.dayForecast.findMany({ where: { tenantId: tenant.id, payrollCosts: { not: null } }, select: { date: true, payrollCosts: true }, orderBy: { date: 'asc' } });
  fs.writeFileSync(backup, JSON.stringify({ tenant: tenant.name, dailyPayrollPct: tenant.dailyPayrollPct, dailyLayout: tenant.dailyLayout, manualPayroll: manual.map((m) => ({ date: m.date.toISOString().slice(0, 10), payrollCosts: Number(m.payrollCosts) })) }, null, 1));
  await db.tenant.update({ where: { id: tenant.id }, data: { dailyPayrollPct: pct, dailyLayout: rows.length ? { rows: next } : Prisma.DbNull } });
  console.log('Застосовано. Резерв:', backup, '· ручних сум оплати праці в резерві:', manual.length);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); }).finally(() => db.$disconnect());
