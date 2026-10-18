'use strict';
// Розміри як дані (2026-10-18): заповнити категорії одягу магазину сіткою підбору (зріст/вага) і межами від експерта —
// тими, що досі жили в ключі воронки SIZE_CHART і у вузлі n_calc. Після цього Олексій править їх у CRM («Категорії» → «Розміри»).
// Категорія одягу = у її товарах (не комплектах) є буквені розміри S…XXXL. Категорії, де сітку вже задано, не чіпаємо (крім --force).
//   node scripts/seed-size-fit-2026-10-18.js --tenant=<назва або id>            перевірка: що буде записано
//   node scripts/seed-size-fit-2026-10-18.js --tenant=<назва або id> --apply    записати
// --chart=<файл.json> — інша сітка (формат {"S":{"height":[a,b],"weight":[c,d]}}), інакше та, що в ключі воронки goverla на 18.10.
const fs = require('node:fs');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
const { db } = require('../packages/db');
const { normalizeFitChart, normalizeSizeRules, normSize } = require('../apps/api/src/lib/sizeFit');

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
const LETTER = new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL']);

(async () => {
    const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
    const apply = process.argv.includes('--apply'), force = process.argv.includes('--force');
    const t = arg('tenant');
    if (!t) { console.log('вкажіть --tenant=<назва або id>'); process.exit(1); }
    const tenant = await db.tenant.findFirst({ where: { OR: [{ id: t }, { name: { equals: t, mode: 'insensitive' } }] }, select: { id: true, name: true } });
    if (!tenant) { console.log('магазин не знайдено:', t); process.exit(1); }
    const chart = normalizeFitChart(arg('chart') ? JSON.parse(fs.readFileSync(arg('chart'), 'utf8')) : CHART_GOVERLA);
    const rules = normalizeSizeRules(RULES_GOVERLA);
    let cats;
    try { cats = await db.category.findMany({ where: { tenantId: tenant.id }, select: { id: true, name: true, fitChart: true, sizeRules: true } }); }
    catch (e) {
        // до міграції 20261018010000_size_fit колонок ще нема — перевірку показати можна, записати ні
        if (apply) throw e;
        console.log('(колонок розмірів у БД ще нема — міграцію не застосовано; показую, що буде записано після неї)');
        cats = await db.$queryRaw`SELECT id, name FROM "Category" WHERE "tenantId" = ${tenant.id}`;
    }
    const prods = await db.product.findMany({ where: { tenantId: tenant.id, isSet: false, categoryId: { not: null } }, select: { categoryId: true, sizes: true } });
    const letterBy = {}, totalBy = {};
    for (const p of prods) {
        totalBy[p.categoryId] = (totalBy[p.categoryId] || 0) + 1;
        if ((p.sizes || []).some((s) => LETTER.has(normSize(s)))) letterBy[p.categoryId] = (letterBy[p.categoryId] || 0) + 1;
    }
    console.log('Магазин: ' + tenant.name + (apply ? ' — ЗАПИС' : ' — перевірка (без --apply нічого не записано)'));
    let n = 0;
    for (const c of cats.sort((a, b) => a.name.localeCompare(b.name, 'uk'))) {
        const letters = letterBy[c.id] || 0, total = totalBy[c.id] || 0;
        const has = c.fitChart && typeof c.fitChart === 'object' && Object.keys(c.fitChart).length;
        let verdict;
        if (!letters) verdict = '— не одяг (буквених розмірів нема), пропуск';
        else if (has && !force) verdict = '— сітку вже задано, не чіпаю';
        else { verdict = '→ сітка ' + Object.keys(chart).join('/') + ' + меж: ' + rules.length; n++; }
        console.log('  ' + c.name + ' (товарів ' + total + ', з буквеними розмірами ' + letters + ') ' + verdict);
        if (apply && letters && (!has || force)) await db.category.update({ where: { id: c.id }, data: { fitChart: chart, sizeRules: rules } });
    }
    console.log((apply ? 'записано' : 'буде записано') + ' категорій: ' + n);
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
