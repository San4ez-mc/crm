// Розкладка «Щоденної аналітики» (2026-11-11): перевірка того, що приходить з адмінки/MCP, перш ніж зберегти в Tenant.dailyLayout.
// Формат — див. apps/admin/src/lib/dailyIndicators.js. Сервер формули не обчислює (рахує адмінка), тут лише гарантуємо
// форму даних: розумні межі, відомі типи, жодних сторонніх полів.
const { ValidationError } = require('@crm/errors');

const ID_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
const FORMATS = ['uah', 'usd', 'pct', 'qty', 'num'];
const OPS = ['×', '÷', '+', '−'];
const MAX_ROWS = 300;

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const ref = (v, where) => { if (!ID_RE.test(String(v || ''))) throw new ValidationError(`${where}: невідомий показник`); return String(v); };
const numStr = (v, where) => {
  const n = Number(String(v).replace(',', '.'));
  if (v === '' || v == null || !Number.isFinite(n) || Math.abs(n) > 1e12) throw new ValidationError(`${where}: потрібне число`);
  return n;
};

function sanitizeTerm(t, i, where) {
  const out = {};
  if (i > 0) { if (!OPS.includes(t && t.op)) throw new ValidationError(`${where}: дія має бути × ÷ + −`); out.op = t.op; }
  if (t && t.ref) out.ref = ref(t.ref, where); else out.num = numStr(t && t.num, where);
  return out;
}

function sanitizeFormula(f, where) {
  if (!f || typeof f !== 'object') throw new ValidationError(`${where}: не задано формулу`);
  if (f.kind === 'percent') return { kind: 'percent', ref: ref(f.ref, where), pct: numStr(f.pct, where) };
  if (f.kind === 'diff') return { kind: 'diff', a: ref(f.a, where), b: ref(f.b, where) };
  if (f.kind === 'expr') { const text = str(f.text, 300); if (!text) throw new ValidationError(`${where}: порожня формула`); return { kind: 'expr', text }; }
  if (f.kind === 'chain') {
    const terms = Array.isArray(f.terms) ? f.terms.slice(0, 12) : [];
    if (!terms.length) throw new ValidationError(`${where}: порожня формула`);
    return { kind: 'chain', terms: terms.map((t, i) => sanitizeTerm(t, i, where)) };
  }
  throw new ValidationError(`${where}: невідомий вид формули`);
}

function sanitizeCustom(c, where) {
  if (!c || typeof c !== 'object') throw new ValidationError(`${where}: некоректний показник`);
  const type = c.type;
  if (!['manual', 'formula', 'auto'].includes(type)) throw new ValidationError(`${where}: тип — ручне введення, формула або з CRM`);
  const out = { type, format: FORMATS.includes(c.format) ? c.format : 'num', decimals: [0, 1, 2].includes(Number(c.decimals)) ? Number(c.decimals) : 2 };
  if (type === 'formula') out.formula = sanitizeFormula(c.formula, where);
  if (type === 'auto') out.auto = { ref: ref(c.auto && c.auto.ref, where) };
  return out;
}

/** Повертає очищену розкладку {rows}. Кидає ValidationError з людським текстом. */
function sanitizeLayout(layout) {
  if (layout === null || layout === undefined) return null;
  const rows = layout && Array.isArray(layout.rows) ? layout.rows : null;
  if (!rows) throw new ValidationError('Розкладка: очікується { rows: [...] }');
  if (rows.length > MAX_ROWS) throw new ValidationError(`Забагато рядків (максимум ${MAX_ROWS})`);
  const seen = new Set(); const out = [];
  for (const e of rows) {
    const id = String((e && e.id) || '');
    if (!ID_RE.test(id) || seen.has(id)) throw new ValidationError('Розкладка: некоректний або повторений id показника');
    seen.add(id);
    const label = str(e.label, 120);
    if (e.custom) {
      if (!id.startsWith('c_')) throw new ValidationError('Розкладка: id власного показника має починатися з c_');
      if (!label) throw new ValidationError('Вкажіть назву показника');
      out.push({ id, label, custom: sanitizeCustom(e.custom, `«${label}»`) });
    } else {
      out.push({ id, ...(e.hidden ? { hidden: true } : {}), ...(label ? { label } : {}) });
    }
  }
  return { rows: out };
}

module.exports = { sanitizeLayout, MAX_ROWS };
