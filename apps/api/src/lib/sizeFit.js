// Розміри як дані (2026-10-18): нормалізація сітки підбору за зростом/вагою (fitChart) і меж від експерта (sizeRules) — одне місце
// для категорій, товарів і MCP, щоб бот (Flows n_calc) завжди отримував той самий формат.
//   fitChart:  {"S":{"height":[160,175],"weight":[55,65]}, …}   (з адмінки приходить і масивом рядків {size,hMin,hMax,wMin,wMax})
//   sizeRules: [{size,wMin,wMax,hMin,hMax,note}]                (перше правило, що збіглося, перекриває сітку)
const { ValidationError } = require('@crm/errors');
const { Prisma } = require('@prisma/client');
// Порожня сітка в БД — Prisma.DbNull: голий null Prisma для Json?-поля не приймає (запис падав би при очищенні сітки).
const EMPTY = Prisma.DbNull;

function normSize(s) {
    // кирилиця, якою пишуть розміри («ХХЛ», «М», «С»), → латиниця; 2XL/3XL → XXL/XXXL (як у боті)
    const v = String(s || '').trim().toUpperCase().replace(/\s+/g, '').replace(/Х/g, 'X').replace(/Л/g, 'L').replace(/С/g, 'S').replace(/М/g, 'M');
    return ({ '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL' })[v] || v;
}
const num = (x) => (x === '' || x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Number(x));

/** EMPTY (Prisma.DbNull) — порожньо (успадковується з категорії / магазину). */
function normalizeFitChart(input) {
    if (input === undefined) return undefined;
    if (input === null || input === '') return EMPTY;
    let rows = [];
    if (Array.isArray(input)) rows = input;
    else if (typeof input === 'object') rows = Object.entries(input).map(([size, r]) => ({ size, hMin: (r.height || [])[0], hMax: (r.height || [])[1], wMin: (r.weight || [])[0], wMax: (r.weight || [])[1] }));
    else throw new ValidationError('fitChart: очікується обʼєкт або список рядків');
    const out = {};
    for (const r of rows) {
        const size = normSize(r && r.size); if (!size) continue;
        const hMin = num(r.hMin), hMax = num(r.hMax), wMin = num(r.wMin), wMax = num(r.wMax);
        if (hMin === null && hMax === null && wMin === null && wMax === null) continue;
        if ((hMin !== null && hMax !== null && hMin > hMax) || (wMin !== null && wMax !== null && wMin > wMax)) throw new ValidationError('fitChart: у розміру ' + size + ' «від» більше за «до»');
        out[size] = { ...(hMin !== null || hMax !== null ? { height: [hMin ?? 0, hMax ?? 300] } : {}), ...(wMin !== null || wMax !== null ? { weight: [wMin ?? 0, wMax ?? 400] } : {}) };
    }
    return Object.keys(out).length ? out : EMPTY;
}

function normalizeSizeRules(input) {
    if (input === undefined) return undefined;
    if (input === null || input === '') return [];
    if (!Array.isArray(input)) throw new ValidationError('sizeRules: очікується список правил');
    const out = [];
    for (const r of input) {
        const size = normSize(r && r.size); if (!size) continue;
        const rule = { size };
        for (const k of ['wMin', 'wMax', 'hMin', 'hMax']) { const v = num(r[k]); if (v !== null) rule[k] = v; }
        if (rule.wMin == null && rule.wMax == null && rule.hMin == null && rule.hMax == null) continue; // правило без умов перекрило б усе
        if ((rule.wMin != null && rule.wMax != null && rule.wMin > rule.wMax) || (rule.hMin != null && rule.hMax != null && rule.hMin > rule.hMax)) throw new ValidationError('sizeRules: у правилі для ' + size + ' «від» більше за «до»');
        if (r.note) rule.note = String(r.note).slice(0, 200);
        out.push(rule);
    }
    return out;
}

module.exports = { normalizeFitChart, normalizeSizeRules, normSize };
