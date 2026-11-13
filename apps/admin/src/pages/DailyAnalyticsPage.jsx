// "Рука на пульсі" — щоденне зведення (весь tenant) + по товару, за зразком таблиць користувача.
// 2026-09-03: картки-по-дню замінено на таблицю (показник — рядок, день — колонка) за проханням
// власника — так природніше порівнювати кілька днів одразу, а не гортати картки. Перша колонка
// (назви показників) приклеєна (`sticky left-0`) — лишається видимою при горизонтальному скролі
// вправо по днях.
import { useEffect, useMemo, useState } from 'react';
import ManagerFilter from '../components/common/ManagerFilter';
import { AddIndicatorModal, EditIndicatorPanel, draftFromRow, customFromDraft } from '../components/daily/IndicatorEditor';
import { applyLayout, layoutFromRows, evalFormula, formatValue, describeFormula, newId } from '../lib/dailyIndicators';
import { api } from '../api/client';
import { PageHeader, Card, Input, Select, ErrorBanner, TrendChart, money, formatDate, kyivDateStr } from '../components/common/Common';
import { useCurrency, CurrencyToggle } from '../components/common/Currency';

// 2026-09-12 (аудит аналітики): "сьогодні" — за київським часом, не UTC (toISOString()).
function periodPreset(preset) {
  const to = new Date();
  const from = new Date();
  if (preset === 'today') { /* from=to=сьогодні */ }
  else if (preset === 'week') from.setDate(to.getDate() - 7);
  else if (preset === 'month') from.setDate(to.getDate() - 30);
  return { from: kyivDateStr(from), to: kyivDateStr(to) };
}

function fmt(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(v) { return v === null || v === undefined ? '—' : `${fmt(v, 1)}%`; }
// Єдиний формат дати (DD.MM.YY, §Common.jsx formatDate) + день тижня коротко — тут це
// заголовок колонки таблиці, весь тиждень одразу перед очима, тож день тижня лишаємо.
function fmtDay(v) { return `${new Date(v).toLocaleDateString('uk-UA', { weekday: 'short' })} ${formatDate(v)}`; }

// rows: [{ label, get:(d)=>string, highlight?, sep? }] — sep=true малює товсту риску НАД цим рядком
// (межа секції, як раніше було <div className="my-2 border-t"/> між групами показників).
// Клітинка прогнозу відмов/повернень: власник вписує свій % для дня (Enter або вихід з поля зберігає); порожнє поле — знову за замовчуванням.
// Поля, які власник вписує вручну. Курс і витрати (2026-11-06, Олексій) діють і на наступні дні, поки не вписано нове: бекенд бере останнє задане.
const EDIT_FIELDS = {
  refusalPct: { custom: 'forecastRefusalCustom', value: 'forecastRefusalPct', suffix: '%', max: 99.99, width: 'w-14' },
  returnPct: { custom: 'forecastReturnCustom', value: 'forecastReturnPct', suffix: '%', max: 99.99, width: 'w-14' },
  fixedCosts: { custom: 'fixedCostsCustom', value: 'dailyFixedCosts', suffix: '₴', max: 10000000, width: 'w-20', hint: 'Введене тут діє і на наступні дні, поки не впишете нове.' },
  payrollCosts: { custom: 'payrollCostsCustom', value: 'dailyPayrollCosts', suffix: '₴', max: 10000000, width: 'w-20', hint: 'Введене тут діє і на наступні дні, поки не впишете нове.' },
  usdRate: { custom: 'usdRateCustom', value: 'usdExchangeRate', suffix: '₴/$', max: 1000, width: 'w-16', hint: 'Курс, який ви вписали, діє і на наступні дні, поки не впишете новий. Порожньо — курс НБУ.' },
};
function ForecastCell({ day, field, onSaved }) {
  const cfg = EDIT_FIELDS[field];
  const custom = day[cfg.custom];
  const value = day[cfg.value];
  const [text, setText] = useState(String(value ?? ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(String(value ?? '')); }, [value]);
  const save = async () => {
    const clean = text.trim().replace(/\s/g, '').replace(',', '.');
    if (clean === String(value ?? '') && custom) return; // нічого не змінилось
    if (clean === String(value ?? '') && !custom) return; // показано перенесене/типове значення, свого не вписано
    if (clean !== '' && !(Number(clean) >= 0 && Number(clean) <= cfg.max)) { setText(String(value ?? '')); return; }
    setBusy(true);
    try { await api.setDayForecast({ date: day.date, [field]: clean === '' ? null : Number(clean) }); onSaved(); }
    catch (e) { setText(String(value ?? '')); } finally { setBusy(false); }
  };
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <input
        value={text}
        disabled={busy}
        inputMode="decimal"
        title={custom ? `Ваше значення для цього дня. Очистіть поле — повернеться значення за замовчуванням. ${cfg.hint || ''}` : `Значення за замовчуванням або перенесене з попереднього дня. Впишіть своє. ${cfg.hint || ''}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className={`${cfg.width} rounded-md border bg-slate-950 px-1.5 py-0.5 text-right text-xs outline-none focus:border-brand ${custom ? 'border-brand/60 text-brand-light' : 'border-slate-700 text-slate-200'}`}
      />
      <span className="text-slate-500">{cfg.suffix}</span>
    </span>
  );
}

// Грошовий рядок у вибраній валюті: сервер дає гривні, у $ ділимо на курс ЦЬОГО дня (він може бути вписаний вручну).
function moneyCell(v, d, cur) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const rate = Number(d.usdExchangeRate);
  // Гривні без копійок (Edits 08.11: «60 копійок, звідки це?» — це десяті від 10% ЗП менеджера з націнки кожного замовлення); долари — з центами.
  return cur === 'USD' && rate > 0 ? fmt(Number(v) / rate) : fmt(v, 0);
}

// Числове значення вбудованого рядка (для формул власних показників). Гривні — сирі, без перемикача $.
function builtinNum(row, d) {
  let v = null;
  if (row.num) v = row.num(d); else if (row.money && row.val) v = row.val(d); else if (row.edit) v = d[EDIT_FIELDS[row.edit].value];
  return v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
}

// Обчислення значення будь-якого рядка (вбудованого чи власного) для дня d; цикл посилань → null.
function makeEval(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const labelToRef = (name) => { const r = rows.find((x) => x.label === name); return r ? r.id : null; };
  function valueOf(id, d, stack = []) {
    const r = byId.get(id);
    if (!r) return null;
    if (!r.custom) return builtinNum(r, d);
    if (stack.includes(id)) return null;
    const c = r.custom; const next = [...stack, id];
    if (c.type === 'manual') { const v = d.custom && d.custom[id] ? d.custom[id].value : null; return v === null || v === undefined ? null : Number(v); }
    if (c.type === 'auto') return valueOf(c.auto && c.auto.ref, d, next);
    return evalFormula(c.formula, (ref) => valueOf(ref, d, next), labelToRef);
  }
  return { valueOf };
}

// Ручна клітинка власного показника: впишіть значення дня (діє й на наступні дні), порожньо — повернеться перенесене.
function CustomManualCell({ row, day, onSaved }) {
  const cell = (day.custom && day.custom[row.id]) || { value: null, own: false };
  const shown = cell.value === null || cell.value === undefined ? '' : String(cell.value);
  const [text, setText] = useState(shown);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(shown); }, [shown]);
  const save = async () => {
    const clean = text.trim().replace(/\s/g, '').replace(',', '.');
    if (clean === shown) return;
    if (clean !== '' && !Number.isFinite(Number(clean))) { setText(shown); return; }
    setBusy(true);
    try { await api.setDayCustomValue({ rowId: row.id, date: day.date, value: clean === '' ? null : Number(clean) }); onSaved(); } catch (e) { setText(shown); } finally { setBusy(false); }
  };
  return (
    <input value={text} disabled={busy} inputMode="decimal" onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      title={cell.own ? 'Ваше значення для цього дня. Очистіть поле — повернеться перенесене з попередніх днів.' : 'Перенесене з попередніх днів. Впишіть своє значення.'}
      className={`w-24 rounded-md border bg-slate-950 px-1.5 py-0.5 text-right text-xs outline-none focus:border-brand ${cell.own ? 'border-brand/60 text-brand-light' : 'border-slate-700 text-slate-200'}`} />
  );
}

// editor (необов'язково, лише «Загальне зведення»): { editMode, valueOf, onEdit, onDelete, onRestore, onDrop } — режим «Керувати показниками».
function MetricsTable({ days, rows, onSaved, cur = 'UAH', editor }) {
  const [dragId, setDragId] = useState(null);
  const edit = editor && editor.editMode;
  const shown = rows.filter((r) => edit || !r.hidden);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
      <table className="text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap">Показник</th>
            {days.map((d) => (
              <th key={d.date} className="border-b border-slate-800 px-3 py-2 text-right text-xs font-medium text-slate-400 whitespace-nowrap">{fmtDay(d.date)}</th>
            ))}
            {edit && <th className="border-b border-slate-800 px-2" />}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={row.id || i} className={`${row.sep ? 'border-t-4 border-t-slate-950' : ''} ${row.hidden ? 'opacity-40' : ''} ${dragId && dragId === row.id ? 'opacity-30' : ''}`}
              onDragOver={edit ? (e) => e.preventDefault() : undefined}
              onDrop={edit ? () => { if (dragId && dragId !== row.id) editor.onDrop(dragId, row.id); setDragId(null); } : undefined}>
              <td className={`sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-3 py-1.5 text-xs whitespace-nowrap ${row.highlight ? 'font-semibold text-brand-light' : 'text-slate-400'}`}>
                {edit && <span draggable onDragStart={() => setDragId(row.id)} onDragEnd={() => setDragId(null)} className="mr-2 cursor-grab select-none text-slate-600 hover:text-slate-300" title="Потягніть, щоб змінити порядок">⋮⋮</span>}
                {row.money && cur === 'USD' ? row.label.replace(', грн', ', $') : row.label}
                {row.custom && edit && <span className="ml-1.5 rounded bg-brand/15 px-1 text-[10px] text-brand-light">власний</span>}
              </td>
              {days.map((d) => {
                if (row.custom) {
                  const c = row.custom;
                  if (c.type === 'manual') return <td key={d.date} className="px-3 py-1.5 text-right text-xs whitespace-nowrap"><CustomManualCell row={row} day={d} onSaved={onSaved} /></td>;
                  const v = editor ? editor.valueOf(row.id, d) : null;
                  return <td key={d.date} className={`px-3 py-1.5 text-right text-xs whitespace-nowrap text-slate-200 ${v !== null && v < 0 ? '!text-red-400' : ''}`}>{formatValue(v, c)}</td>;
                }
                const raw = row.money ? row.val(d) : null;
                return (
                  <td key={d.date} className={`px-3 py-1.5 text-right text-xs whitespace-nowrap ${row.highlight ? 'font-semibold text-brand-light' : 'text-slate-200'} ${row.money && Number(raw) < 0 ? '!text-red-400' : ''}`}>
                    {row.edit ? <ForecastCell day={d} field={row.edit} onSaved={onSaved} /> : row.money ? moneyCell(raw, d, cur) : row.get(d)}
                  </td>
                );
              })}
              {edit && (
                <td className="whitespace-nowrap px-2 py-1.5 text-right">
                  {row.hidden
                    ? <button onClick={() => editor.onRestore(row)} className="text-xs text-brand-light hover:underline" title="Показати рядок">показати</button>
                    : (<>
                      <button onClick={() => editor.onEdit(row)} className="mr-2 text-slate-400 hover:text-brand-light" title="Редагувати показник">✎</button>
                      <button onClick={() => editor.onDelete(row)} className="text-red-400/80 hover:text-red-400" title={row.custom ? 'Видалити показник' : 'Сховати показник'}>🗑</button>
                    </>)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 2026-09-07: усі грошові показники сервер уже повертає в ГРИВНЯХ (рекламний бюджет із Meta
// конвертується з $ по курсу НБУ на бекенді — lib/currency.js) — лейбли раніше помилково
// казали "$"/"дол", хоча цифри під ними завжди були грн (окрім рекламного бюджету, який
// справді був $ до цього фіксу). adSpendUsd — сирий $ з Meta, лише для довідки/звірки.
// money: true — рядок у гривнях, що перемикається на $ за курсом дня (val повертає число в грн); edit — клітинка, яку вписує власник.
const SUMMARY_ROWS = [
  { id: 'marginAvgNonRefused', label: 'Маржинальний прибуток ср. без відмов, грн', money: true, val: (d) => d.marginAvgNonRefused },
  { id: 'marginAvgWithRefused', label: 'Маржинальний прибуток ср. з відмовами, грн', money: true, val: (d) => d.marginAvgWithRefused },
  { id: 'orderPrice', label: 'Ціна замовлення, грн', money: true, val: (d) => d.orderPrice },
  { id: 'profitPerClientNoPayroll', label: 'Прибуток з клієнта без ЗП, грн', money: true, val: (d) => d.profitPerClientNoPayroll },
  { id: 'profitPerClientWithPayroll', label: 'Прибуток з клієнта із ЗП, грн', money: true, val: (d) => d.profitPerClientWithPayroll },
  { id: 'messagePrice', label: 'Ціна повідомлення, грн', money: true, val: (d) => d.messagePrice },
  { id: 'conversionToSale', label: 'Конверсія у продаж, %', get: (d) => pct(d.conversionToSale !== null ? d.conversionToSale * 100 : null), num: (d) => (d.conversionToSale != null ? d.conversionToSale * 100 : null) },
  { id: 'marginTotal', label: 'Маржинальний прибуток всього (після ЗП менеджерів), грн', money: true, val: (d) => d.marginTotal, sep: true },
  { id: 'marginBeforeManagerPay', label: 'Націнка всього (маржа до ЗП менеджерів), грн', money: true, val: (d) => d.marginBeforeManagerPay },
  { id: 'managerPay', label: 'ЗП менеджерів за % від націнки, грн (факт)', money: true, val: (d) => d.managerPay },
  { id: 'marginTotalForecast', label: 'Маржинальний прибуток всього із прогнозованими відмовами (після ЗП менеджерів), грн', money: true, val: (d) => d.marginTotalForecast, highlight: true },
  { id: 'managerPayForecast', label: 'ЗП менеджерів за %, грн (орієнтовно, із прогнозом відмов)', money: true, val: (d) => d.managerPayForecast },
  { id: 'adSpend', label: 'Рекламний бюджет, грн', money: true, val: (d) => d.adSpend },
  { id: 'adSpendUsd', label: 'Рекламний бюджет, $ (як з Meta)', get: (d) => (d.adSpendUsd === null ? '—' : `$${fmt(d.adSpendUsd)}`), num: (d) => d.adSpendUsd },
  { id: 'newMessages', label: 'Нові контакти в повідомленнях', get: (d) => d.newMessages, num: (d) => d.newMessages },
  { id: 'ordersCount', label: 'Замовлень, к-сть', get: (d) => d.ordersCount, num: (d) => d.ordersCount },
  { id: 'qtySold', label: 'Товарів, к-сть (штук)', get: (d) => d.qtySold, num: (d) => d.qtySold },
  { id: 'qtyRepeat', label: 'Повторно продані товари', get: (d) => d.qtyRepeat, num: (d) => d.qtyRepeat },
  { id: 'clicks', label: 'Кліки', get: (d) => d.clicks, num: (d) => d.clicks },
  { id: 'impressions', label: 'Покази', get: (d) => d.impressions, num: (d) => d.impressions },
  { id: 'roi', label: 'Окупність', get: (d) => fmt(d.roi), highlight: true, sep: true, num: (d) => d.roi },
  { id: 'roiForecast', label: 'Окупність із прогнозованими відмовами', get: (d) => fmt(d.roiForecast), highlight: true, num: (d) => d.roiForecast },
  { id: 'expectedProfit', label: 'Очікуваний прибуток, грн', money: true, val: (d) => d.expectedProfit, highlight: true },
  { id: 'usdRate', label: 'Курс долара, грн', edit: 'usdRate', sep: true },
  { id: 'refusalRate', label: 'Відсоток відмов, %', get: (d) => pct(d.refusalRate), num: (d) => d.refusalRate },
  { id: 'refusalPct', label: 'Відсоток відмов прогнозований, %', edit: 'refusalPct' },
  { id: 'returnRate', label: 'Відсоток повернень, %', get: (d) => pct(d.returnRate), num: (d) => d.returnRate },
  { id: 'returnPct', label: 'Відсоток повернень прогнозований, %', edit: 'returnPct' },
  { id: 'fixedCosts', label: 'Постійні витрати, грн', edit: 'fixedCosts' },
  { id: 'payrollCosts', label: 'Витрати на оплату праці, грн', edit: 'payrollCosts' },
  { id: 'aiCost', label: 'Витрати на токени Claude, грн', money: true, val: (d) => d.aiCost },
  { id: 'profitNoPayroll', label: 'Прибуток без ЗП, грн', money: true, val: (d) => d.profitNoPayroll },
  { id: 'newCustomerCost', label: 'Ціна клієнта нового, грн', money: true, val: (d) => d.newCustomerCost },
  { id: 'cpc', label: 'CPC (ціна за клік)', money: true, val: (d) => d.cpc },
  { id: 'ctr', label: 'CTR (кліків зі 100 показів)', get: (d) => pct(d.ctr), num: (d) => d.ctr },
  { id: 'cpm', label: 'CPM (ціна 1000 показів)', money: true, val: (d) => d.cpm },
  { id: 'repeatSalesRate', label: 'Повторних продажів, %', get: (d) => pct(d.repeatSalesRate), num: (d) => d.repeatSalesRate },
];

const PRODUCT_ROWS = [
  { label: 'Реклама, грн', get: (d) => fmt(d.adSpend) },
  { label: 'Повідомлень з реклам', get: (d) => d.messages },
  { label: 'Замовлень (шт)', get: (d) => d.ordersCount },
  { label: 'Маржинальний прибуток із замовлення', get: (d) => fmt(d.marginPerOrder) },
  { label: 'Маржинальний прибуток всього', get: (d) => fmt(d.marginTotal) },
  { label: 'Маржинальний прибуток всього із відмовами', get: (d) => fmt(d.marginTotalWithRefused) },
  { label: 'Ціна за лід', get: (d) => fmt(d.messagePrice) },
  { label: 'Ціна за замовлення', get: (d) => fmt(d.orderPrice) },
  { label: 'Конверсія із повідом. в замов, %', get: (d) => pct(d.conversionToOrder) },
  { label: 'Відмови', get: (d) => pct(d.refusalRate) },
  { label: 'Курс', get: (d) => fmt(d.usdExchangeRate, 0) },
  { label: 'Окупність', get: (d) => fmt(d.roi), highlight: true, sep: true },
  { label: 'Прибуток', get: (d) => fmt(d.profit), highlight: true },
];

export default function DailyAnalyticsPage() {
  const [tab, setTab] = useState('summary'); // summary | product
  const [range, setRange] = useState(periodPreset('week'));
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [productDaily, setProductDaily] = useState(null);
  const [error, setError] = useState('');
  const [manager, setManager] = useState(''); // фільтр «хто оформив»
  const [cur, setCur] = useCurrency(); // грн/$ (Edits 06.11: «додати перемикач гривні-долари»); вибір пам'ятається в браузері

  useEffect(() => { api.listProducts().then((r) => setProducts(r.data)).catch(() => {}); }, []);

  const load = () => {
    setError('');
    if (tab === 'summary') {
      api.analyticsDaily({ ...range, ...(manager ? { placedBy: manager } : {}) }).then((r) => setSummary(r.data)).catch((e) => setError(e.message));
    } else if (productId) {
      api.analyticsProductDaily({ ...range, productId, ...(manager ? { placedBy: manager } : {}) }).then((r) => setProductDaily(r.data)).catch((e) => setError(e.message));
    }
  };
  useEffect(load, [tab, range.from, range.to, productId, manager]);

  const summaryDays = (summary || []).slice().reverse(); // новий день — лівіша колонка
  const productDays = (productDaily || []).slice().reverse();

  // ── Власні показники (Edits bb8fe39f / 26d9b146): розкладка таблиці, режим «Керувати показниками», шаблони ──
  const [layout, setLayout] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => { api.dailyLayout().then((r) => { setLayout(r.data.layout); setTemplates(r.data.templates || []); }).catch(() => {}); }, []);
  const rows = useMemo(() => applyLayout(SUMMARY_ROWS, layout), [layout]);
  const evaluator = useMemo(() => makeEval(rows), [rows]);
  const options = rows.map((r) => ({ id: r.id, label: r.label, custom: !!r.custom }));
  const editingRow = editingId ? rows.find((r) => r.id === editingId) : null;

  const commit = async (nextRows) => {
    const nl = layoutFromRows(nextRows, SUMMARY_ROWS);
    setLayout(nl);
    try { await api.saveDailyLayout(nl); } catch (e) { setError(e.message); api.dailyLayout().then((r) => setLayout(r.data.layout)).catch(() => {}); }
  };
  const insertAfter = (list, item, afterId) => { const i = afterId ? list.findIndex((r) => r.id === afterId) : -1; const c = [...list]; c.splice(i >= 0 ? i + 1 : c.length, 0, item); return c; };
  const addRow = (part, afterId) => { commit(insertAfter(rows, { id: newId(), ...part }, afterId)); setAdding(false); };
  const saveRow = (id, part) => { commit(rows.map((r) => (r.id !== id ? r : r.custom ? { ...r, ...part } : { ...r, label: part.label }))); setEditingId(null); };
  const deleteRow = (row) => {
    if (row.custom) { if (!window.confirm(`Видалити показник «${row.label}»?`)) return; commit(rows.filter((r) => r.id !== row.id)); }
    else commit(rows.map((r) => (r.id === row.id ? { ...r, hidden: true } : r)));
    setEditingId(null);
  };
  const restoreRow = (row) => commit(rows.map((r) => (r.id === row.id ? { ...r, hidden: false } : r)));
  const moveRow = (id, dir) => { const i = rows.findIndex((r) => r.id === id); const j = i + dir; if (i < 0 || j < 0 || j >= rows.length) return; const c = [...rows]; [c[i], c[j]] = [c[j], c[i]]; commit(c); };
  const dropRow = (fromId, toId) => { const from = rows.findIndex((r) => r.id === fromId); const to = rows.findIndex((r) => r.id === toId); if (from < 0 || to < 0) return; const c = [...rows]; const [it] = c.splice(from, 1); c.splice(to, 0, it); commit(c); };
  const duplicateRow = (row) => {
    const copy = row.custom
      ? { id: newId(), label: row.label + ' (копія)', custom: JSON.parse(JSON.stringify(row.custom)) }
      : { id: newId(), label: row.label + ' (копія)', custom: { type: 'auto', format: row.money ? 'uah' : 'num', decimals: 2, auto: { ref: row.id } } };
    commit(insertAfter(rows, copy, row.id)); setEditingId(copy.id);
  };
  const saveTemplate = async () => {
    const name = window.prompt('Назва шаблону розкладки');
    if (!name || !name.trim()) return;
    try { const r = await api.saveDailyTemplate(name.trim(), layoutFromRows(rows, SUMMARY_ROWS)); setTemplates([...templates, r.data]); } catch (e) { setError(e.message); }
  };
  const applyTemplate = (t) => {
    if (!window.confirm(`Застосувати шаблон «${t.name}»? Поточна розкладка таблиці замінюється (значення, які ви вписували, лишаються).`)) return;
    setLayout(t.layout); api.saveDailyLayout(t.layout).catch((e) => setError(e.message));
  };
  const resetLayout = () => {
    if (!window.confirm('Повернути стандартну розкладку? Власні показники зникнуть із таблиці (значення, які ви вписували, збережуться).')) return;
    setLayout(null); api.saveDailyLayout(null).catch((e) => setError(e.message));
  };
  const removeTemplate = async (t) => {
    if (!window.confirm(`Видалити шаблон «${t.name}»?`)) return;
    try { await api.deleteDailyTemplate(t.id); setTemplates(templates.filter((x) => x.id !== t.id)); } catch (e) { setError(e.message); }
  };

  // Приклад у вікні показника: підставляємо значення найсвіжішого дня таблиці («Приклад: 21 180,61 × 0,1 = 2 118,06»).
  const previewFor = (draft, selfId) => {
    const day = summaryDays[0];
    const built = customFromDraft({ ...draft, label: draft.label || 'Показник' });
    if (!day || built.error) return null;
    const tmpId = selfId || '__preview';
    const withTmp = [...rows.filter((r) => r.id !== tmpId), { id: tmpId, label: draft.label || 'Показник', custom: built.custom }];
    const v = makeEval(withTmp).valueOf(tmpId, day);
    const val = (ref) => { const x = makeEval(rows).valueOf(ref, day); return x === null ? '—' : fmt(x); };
    const f = built.custom.formula;
    let sub = '';
    if (f && f.kind === 'percent') sub = `${val(f.ref)} × ${fmt(f.pct / 100, 4).replace(/0+$/, '').replace(/,$/, '')}`;
    else if (f && f.kind === 'diff') sub = `${val(f.a)} − ${val(f.b)}`;
    else if (f && f.kind === 'chain') sub = f.terms.map((t, i) => (i ? ` ${t.op} ` : '') + (t.ref ? val(t.ref) : String(t.num).replace('.', ','))).join('');
    else if (f && f.kind === 'expr') sub = describeFormula(f, (id) => id);
    return { dayLabel: fmtDay(day.date), text: `${sub ? sub + ' = ' : ''}${formatValue(v, built.custom)}` };
  };

  return (
    <div>
      <PageHeader
        title="Щоденна аналітика"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'summary' && <CurrencyToggle cur={cur} setCur={setCur} usdRate={summary && summary.length ? summary[summary.length - 1].usdExchangeRate : null} />}
            {tab === 'summary' && (
              <>
                <button onClick={() => setEditMode(!editMode)} className={`rounded-lg border px-3 py-1.5 text-xs ${editMode ? 'border-brand bg-brand/15 text-brand-light' : 'border-brand/60 text-brand-light hover:bg-brand/10'}`}>▦ Керувати показниками</button>
                <button onClick={saveTemplate} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:border-brand">🔖 Зберегти як шаблон</button>
                <details className="relative">
                  <summary className="cursor-pointer list-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:border-brand">Шаблони ▾</summary>
                  <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl">
                    <button onClick={resetLayout} className="block w-full rounded-lg px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800">Стандартна розкладка</button>
                    {templates.map((t) => (
                      <div key={t.id} className="flex items-center gap-1 rounded-lg hover:bg-slate-800">
                        <button onClick={() => applyTemplate(t)} className="flex-1 truncate px-3 py-1.5 text-left text-xs text-slate-200">{t.name}</button>
                        <button onClick={() => removeTemplate(t)} className="px-2 text-xs text-slate-500 hover:text-red-400" title="Видалити шаблон">✕</button>
                      </div>
                    ))}
                    {!templates.length && <div className="px-3 py-1.5 text-xs text-slate-500">Збережених шаблонів ще немає.</div>}
                  </div>
                </details>
              </>
            )}
            {['summary', 'product'].map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-xs ${tab === t ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300'}`}>
                {t === 'summary' ? 'Загальне зведення' : 'По товару'}
              </button>
            ))}
          </div>
        }
      />
      <ErrorBanner message={error} />

      {tab === 'summary' && editMode && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
          <div className="min-w-[16rem] flex-1">
            <div className="text-sm font-semibold text-slate-100">Режим редагування показників</div>
            <div className="text-xs text-slate-400">Додавайте, видаляйте, змінюйте порядок рядків (потягніть ⋮⋮), налаштовуйте формули та ручне введення.</div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked readOnly /> Режим редагування увімкнено</label>
          <button onClick={() => setAdding(true)} className="rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-dark">+ Додати показник</button>
          <button onClick={() => { setEditMode(false); setEditingId(null); }} className="rounded-lg border border-slate-600 px-3.5 py-2 text-sm text-slate-200 hover:bg-slate-800">✓ Готово</button>
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['today', 'week', 'month'].map((p) => (
          <button key={p} onClick={() => setRange(periodPreset(p))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs hover:border-brand">
            {{ today: 'Сьогодні', week: 'Тиждень', month: 'Місяць' }[p]}
          </button>
        ))}
        <Input type="date" className="!w-auto" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-slate-500">—</span>
        <Input type="date" className="!w-auto" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <div className="ml-2"><ManagerFilter value={manager} onChange={setManager} /></div>
        {tab === 'product' && (
          <Select className="max-w-xs" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">— оберіть товар —</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </Select>
        )}
      </div>

      {tab === 'summary' && (
        <div>
          {summaryDays.length > 1 && (
            <Card className="mb-4 p-4">
              <h3 className="mb-3 text-sm font-semibold">Прибуток по днях <span className="font-normal text-slate-500">(тренд за обраний період)</span></h3>
              <TrendChart
                data={summary.map((d) => ({ ...d, shownProfit: cur === 'USD' && Number(d.usdExchangeRate) > 0 ? d.expectedProfit / Number(d.usdExchangeRate) : d.expectedProfit }))}
                valueKey="shownProfit"
                formatValue={(v) => (cur === 'USD' ? `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}` : money(v))}
              />
            </Card>
          )}
          {summaryDays.length === 0 ? (
            <Card className="p-5 text-sm text-slate-500">Даних за період немає.</Card>
          ) : (
            <>
              <MetricsTable days={summaryDays} rows={rows} onSaved={load} cur={cur}
                editor={{ editMode, valueOf: evaluator.valueOf, onEdit: (r) => setEditingId(r.id), onDelete: deleteRow, onRestore: restoreRow, onDrop: dropRow }} />
              <p className="mt-2 text-xs text-slate-500">
                «З прогнозованими відмовами» = маржинальний прибуток мінус ще не відбуті відмови й повернення: прогноз дня (клітинка, за замовчуванням — з «Налаштування → Загальні») × замовлень дня мінус ті відмови, що вже є.
                Витрати на токени — вартість ШІ-бота в розмовах, що почались цього дня (за тарифами моделей).
                Курс, постійні витрати та оплату праці можна вписати в клітинках рядка: значення діє і на наступні дні, поки не впишете нове. Скасовані та видалені замовлення в звіт не потрапляють.
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'product' && (
        !productId ? (
          <Card className="p-5 text-sm text-slate-500">Оберіть товар вище.</Card>
        ) : (
          <div>
            {productDays.length > 1 && (
              <Card className="mb-4 p-4">
                <h3 className="mb-3 text-sm font-semibold">Прибуток по днях <span className="font-normal text-slate-500">(тренд за обраний період)</span></h3>
                <TrendChart data={productDaily} valueKey="profit" formatValue={(v) => money(v)} />
              </Card>
            )}
            {productDays.length === 0 ? (
              <Card className="p-5 text-sm text-slate-500">Даних за період немає.</Card>
            ) : (
              <MetricsTable days={productDays} rows={PRODUCT_ROWS} />
            )}
          </div>
        )
      )}

      {adding && <AddIndicatorModal onClose={() => setAdding(false)} onAdd={addRow} options={options} afterOptions={options} previewFor={(d) => previewFor(d)} />}
      {editingRow && (
        <EditIndicatorPanel
          key={editingRow.id} row={editingRow} options={options.filter((o) => o.id !== editingRow.id)} previewFor={(d) => previewFor(d, editingRow.id)}
          onSave={(part) => saveRow(editingRow.id, part)} onClose={() => setEditingId(null)} onDuplicate={() => duplicateRow(editingRow)}
          onMove={(dir) => moveRow(editingRow.id, dir)} onDelete={() => deleteRow(editingRow)}
          canUp={rows.findIndex((r) => r.id === editingRow.id) > 0} canDown={rows.findIndex((r) => r.id === editingRow.id) < rows.length - 1}
        />
      )}
    </div>
  );
}
