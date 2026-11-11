// «Щоденна аналітика»: власні показники (Edits bb8fe39f / 26d9b146, 10.11). Власник сам додає рядки таблиці, обирає тип (ручне введення, формула,
// з CRM), формат (грн, $, %, шт., число), округлення і місце. Тут — чиста логіка без React: розрахунок формул, формат клітинки, злиття розкладки
// з вбудованими рядками. Розкладка зберігається на сервері (Tenant.dailyLayout), ручні значення — DayCustomValue.
//
// Розкладка: { rows: [ {id, hidden?, label?}                       — вбудований показник (id = його ключ у DailyAnalyticsPage)
//                    | {id, custom:{ type, format, decimals, ... }} ] } — власний показник
// custom.type: 'manual' | 'formula' | 'auto'
//   formula: { kind:'percent', ref, pct } | { kind:'chain', terms:[{ref|num}, {op, ref|num}…] } | { kind:'diff', a, b } | { kind:'expr', text }
//   auto:    { ref } — показати вбудований показник під своєю назвою й форматом

export const FORMATS = [
  { id: 'uah', label: 'Гривня (₴)', suffix: ' ₴' },
  { id: 'usd', label: 'Долар ($)', prefix: '$' },
  { id: 'pct', label: 'Відсоток (%)', suffix: '%' },
  { id: 'qty', label: 'Штуки (шт.)', suffix: ' шт.' },
  { id: 'num', label: 'Звичайне число' },
];
export const DECIMALS = [0, 1, 2];
export const OPS = ['×', '÷', '+', '−'];

export function newId() { return 'c_' + Math.random().toString(36).slice(2, 10); }

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function formatValue(v, { format = 'num', decimals = 2 } = {}) {
  if (!isNum(v)) return '—';
  const f = FORMATS.find((x) => x.id === format) || FORMATS[4];
  const s = v.toLocaleString('uk-UA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (f.prefix || '') + s + (f.suffix || '');
}

// ── Власна формула «{Назва показника} × 0,1 − ({Інший} + 5)» ────────────────────────────────────────────────────────────
// Безпечний розбір арифметики без eval: числа, + − × ÷ * /, дужки, унарний мінус.
export function evalArithmetic(src) {
  const s = String(src).replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−|–/g, '-').replace(/,/g, '.');
  if (!s || /[^0-9.+\-*/()]/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  function number() {
    const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i));
    if (!m) throw new Error('num');
    i += m[0].length; return parseFloat(m[0]);
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('paren'); i++; return v; }
    return number();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') { const op = s[i++]; const r = factor(); if (op === '/' && r === 0) throw new Error('div0'); v = op === '*' ? v * r : v / r; }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  try { const v = expr(); return i === s.length && Number.isFinite(v) ? v : null; } catch (e) { return null; }
}

/** Обчислити формулу. resolve(ref) → число | null; labelToRef — для {Назва} у власній формулі. Будь-який невідомий вхід → null («—»). */
export function evalFormula(f, resolve, labelToRef = () => null) {
  if (!f || !f.kind) return null;
  const toNum = (x) => { if (x === '' || x == null) return null; const n = Number(String(x).replace(',', '.')); return isNum(n) ? n : null; };
  const val = (t) => (!t ? null : t.ref != null && t.ref !== '' ? resolve(t.ref) : toNum(t.num));
  if (f.kind === 'percent') { const a = resolve(f.ref); const p = toNum(f.pct); return isNum(a) && isNum(p) ? (a * p) / 100 : null; }
  if (f.kind === 'diff') { const a = resolve(f.a); const b = resolve(f.b); return isNum(a) && isNum(b) ? a - b : null; }
  if (f.kind === 'chain') {
    const terms = Array.isArray(f.terms) ? f.terms : [];
    if (!terms.length) return null;
    let acc = val(terms[0]); if (!isNum(acc)) return null;
    for (const t of terms.slice(1)) {
      const x = val(t); if (!isNum(x)) return null;
      if (t.op === '×') acc *= x; else if (t.op === '÷') { if (x === 0) return null; acc /= x; } else if (t.op === '+') acc += x; else if (t.op === '−') acc -= x; else return null;
    }
    return Number.isFinite(acc) ? acc : null;
  }
  if (f.kind === 'expr') {
    let bad = false;
    const text = String(f.text || '').replace(/\{([^{}]+)\}/g, (_, name) => {
      const ref = labelToRef(name.trim()); const v = ref ? resolve(ref) : null;
      if (!isNum(v)) { bad = true; return '0'; }
      return v < 0 ? `(${v})` : String(v);
    });
    return bad ? null : evalArithmetic(text);
  }
  return null;
}

/** Текст формули для підказок: «Маржа × 0,1». */
export function describeFormula(f, nameOf) {
  if (!f) return '';
  if (f.kind === 'percent') return `${f.pct}% від «${nameOf(f.ref)}»`;
  if (f.kind === 'diff') return `«${nameOf(f.a)}» − «${nameOf(f.b)}»`;
  if (f.kind === 'expr') return String(f.text || '');
  if (f.kind === 'chain') return (f.terms || []).map((t, i) => (i ? ` ${t.op} ` : '') + (t.ref ? `«${nameOf(t.ref)}»` : String(t.num ?? ''))).join('');
  return '';
}

/** Рядки таблиці в порядку розкладки: вбудовані (з перейменуванням/сховані) + власні. Нових вбудованих, яких ще нема в розкладці, додаємо після попереднього. */
export function applyLayout(builtins, layout) {
  const byId = new Map(builtins.map((b) => [b.id, b]));
  const out = []; const seen = new Set();
  for (const e of (layout && Array.isArray(layout.rows) ? layout.rows : [])) {
    if (e.custom) { out.push({ id: e.id, custom: e.custom, label: e.label || 'Показник' }); seen.add(e.id); continue; }
    const b = byId.get(e.id); if (!b || seen.has(e.id)) continue;
    seen.add(e.id); out.push({ ...b, label: e.label || b.label, hidden: !!e.hidden, renamed: !!e.label });
  }
  builtins.forEach((b, i) => {
    if (seen.has(b.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = out.findIndex((r) => r.id === builtins[j].id); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, { ...b, hidden: false });
  });
  return out;
}

/** Розкладка для збереження з поточного списку рядків (порядок, сховані, перейменування, власні). */
export function layoutFromRows(rows, builtins) {
  const def = new Map(builtins.map((b) => [b.id, b]));
  return {
    rows: rows.map((r) => (r.custom
      ? { id: r.id, label: r.label, custom: r.custom }
      : { id: r.id, ...(r.hidden ? { hidden: true } : {}), ...(r.label && def.get(r.id) && r.label !== def.get(r.id).label ? { label: r.label } : {}) })),
  };
}
