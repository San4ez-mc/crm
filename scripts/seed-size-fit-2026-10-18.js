'use strict';
// Розміри як дані (2026-10-18): перенести загальну сітку підбору (зріст/вага) і межі від експерта з ключа воронки SIZE_CHART /
// вузла n_calc у CRM — у налаштування магазину («Налаштування → Загальні» → «Розміри за замовчуванням»). Категорії й товари не
// чіпаємо: порожні успадковують сітку магазину (бот: товар → категорія → магазин). Уже задану сітку магазину не перезаписуємо (крім --force).
//   node scripts/seed-size-fit-2026-10-18.js --tenant=<назва або id>            перевірка: що буде записано
//   node scripts/seed-size-fit-2026-10-18.js --tenant=<назва або id> --apply    записати
// --chart=<файл.json> — інша сітка (формат {"S":{"height":[a,b],"weight":[c,d]}}), інакше та, що в ключі воронки goverla на 18.10.
const fs = require('node:fs');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { db } = require('../packages/db');
const { normalizeFitChart, normalizeSizeRules } = require('../apps/api/src/lib/sizeFit');

// ключ SIZE_CHART воронки goverla (Flows) на 18.10.2026
const CHART_GOVERLA = {
    S: { height: [160, 175], weight: [55, 65] }, M: { height: [170, 180], weight: [65, 75] }, L: { height: [175, 185], weight: [75, 85] },
    XL: { height: [175, 185], weight: [85, 100] }, XXL: { height: [180, 190], weight: [100, 110] }, XXXL: { height: [180, 190], weight: [110, 120] },
};
// межі від Олексія (звірка 17.10, 83 приклади)
const RULES_GOVERLA = [
    { size: 'S', wMin: 50, wMax: 66, hMax: 178, note: 'до 66 кг і до 178 см — S; невисокому M висітиме' },
    { size: 'S', wMin: 50, wMax: 68, hMax: 174, note: 'невисокий до 68 кг — S' },
    { size: 'M', wMin: 75, wMax: 75, hMax: 174, note: '75 кг і до 174 см — M (S буде малий)' },
    { size: 'XXL', wMin: 96, wMax: 99, note: '96–99 кг підійдуть XL і XXL, XXL менш ризиковано' },
];
const hasChart = (c) => !!(c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length);

(async () => {
    const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
    const apply = process.argv.includes('--apply'), force = process.argv.includes('--force');
    const t = arg('tenant');
    if (!t) { console.log('вкажіть --tenant=<назва або id>'); process.exit(1); }
    const tenant = await db.tenant.findFirst({ where: { OR: [{ id: t }, { name: { equals: t, mode: 'insensitive' } }] }, select: { id: true, name: true } });
    if (!tenant) { console.log('магазин не знайдено:', t); process.exit(1); }
    const chart = normalizeFitChart(arg('chart') ? JSON.parse(fs.readFileSync(arg('chart'), 'utf8')) : CHART_GOVERLA);
    const rules = normalizeSizeRules(RULES_GOVERLA);
    let cur = null, cats = [];
    try {
        cur = await db.tenant.findUnique({ where: { id: tenant.id }, select: { fitChart: true, sizeRules: true } });
        cats = await db.category.findMany({ where: { tenantId: tenant.id }, select: { name: true, fitChart: true, sizeRules: true } });
    } catch (e) {
        // до міграції 20261018010000_size_fit колонок ще нема — перевірку показати можна, записати ні
        if (apply) throw e;
        console.log('(колонок розмірів у БД ще нема — міграцію не застосовано; показую, що буде записано після неї)');
    }
    console.log('Магазин: ' + tenant.name + (apply ? ' — ЗАПИС' : ' — перевірка (без --apply нічого не записано)'));
    Object.entries(chart).forEach(([s, r]) => console.log('  ' + s.padEnd(5) + ' зріст ' + r.height.join('–') + ' см, вага ' + r.weight.join('–') + ' кг'));
    rules.forEach((r) => console.log('  межа: ' + r.size + ' — ' + [r.wMin != null && 'вага від ' + r.wMin, r.wMax != null && 'до ' + r.wMax, r.hMin != null && 'зріст від ' + r.hMin, r.hMax != null && 'зріст до ' + r.hMax].filter(Boolean).join(', ')));
    const own = cats.filter((c) => hasChart(c.fitChart) || (Array.isArray(c.sizeRules) && c.sizeRules.length));
    console.log('Категорії зі своєю сіткою/межами (перекривають магазин): ' + (own.length ? own.map((c) => c.name).join(', ') : 'немає'));
    if (cur && hasChart(cur.fitChart) && !force) { console.log('Сітку магазину вже задано — не перезаписую (--force, щоб перезаписати).'); process.exit(0); }
    if (apply) { await db.tenant.update({ where: { id: tenant.id }, data: { fitChart: chart, sizeRules: rules } }); console.log('записано: сітка магазину + меж ' + rules.length); }
    else console.log('буде записано: сітка магазину (' + Object.keys(chart).length + ' розмірів) + меж ' + rules.length);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
