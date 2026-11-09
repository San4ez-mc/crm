// "Рука на пульсі" — щоденне зведення (весь tenant) + по товару, за зразком таблиць користувача.
// 2026-09-03: картки-по-дню замінено на таблицю (показник — рядок, день — колонка) за проханням
// власника — так природніше порівнювати кілька днів одразу, а не гортати картки. Перша колонка
// (назви показників) приклеєна (`sticky left-0`) — лишається видимою при горизонтальному скролі
// вправо по днях.
import { useEffect, useState } from 'react';
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

function MetricsTable({ days, rows, onSaved, cur = 'UAH' }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
      <table className="text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-slate-800 bg-slate-900 px-3 py-2 text-left text-xs font-medium text-slate-500 whitespace-nowrap">Показник</th>
            {days.map((d) => (
              <th key={d.date} className="border-b border-slate-800 px-3 py-2 text-right text-xs font-medium text-slate-400 whitespace-nowrap">{fmtDay(d.date)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={row.sep ? 'border-t-4 border-t-slate-950' : ''}>
              <td className={`sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-3 py-1.5 text-xs whitespace-nowrap ${row.highlight ? 'font-semibold text-brand-light' : 'text-slate-400'}`}>{row.money && cur === 'USD' ? row.label.replace(', грн', ', $') : row.label}</td>
              {days.map((d) => {
                const raw = row.money ? row.val(d) : null;
                return (
                  <td key={d.date} className={`px-3 py-1.5 text-right text-xs whitespace-nowrap ${row.highlight ? 'font-semibold text-brand-light' : 'text-slate-200'} ${row.money && Number(raw) < 0 ? '!text-red-400' : ''}`}>
                    {row.edit ? <ForecastCell day={d} field={row.edit} onSaved={onSaved} /> : row.money ? moneyCell(raw, d, cur) : row.get(d)}
                  </td>
                );
              })}
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
  { label: 'Маржинальний прибуток ср. без відмов, грн', money: true, val: (d) => d.marginAvgNonRefused },
  { label: 'Маржинальний прибуток ср. з відмовами, грн', money: true, val: (d) => d.marginAvgWithRefused },
  { label: 'Ціна замовлення, грн', money: true, val: (d) => d.orderPrice },
  { label: 'Прибуток з клієнта без ЗП, грн', money: true, val: (d) => d.profitPerClientNoPayroll },
  { label: 'Прибуток з клієнта із ЗП, грн', money: true, val: (d) => d.profitPerClientWithPayroll },
  { label: 'Ціна повідомлення, грн', money: true, val: (d) => d.messagePrice },
  { label: 'Конверсія у продаж, %', get: (d) => pct(d.conversionToSale !== null ? d.conversionToSale * 100 : null) },
  { label: 'Маржинальний прибуток всього, грн', money: true, val: (d) => d.marginTotal, sep: true },
  { label: 'Маржинальний прибуток всього із прогнозованими відмовами, грн', money: true, val: (d) => d.marginTotalForecast, highlight: true },
  { label: 'Рекламний бюджет, грн', money: true, val: (d) => d.adSpend },
  { label: 'Рекламний бюджет, $ (як з Meta)', get: (d) => (d.adSpendUsd === null ? '—' : `$${fmt(d.adSpendUsd)}`) },
  { label: 'Нові контакти в повідомленнях', get: (d) => d.newMessages },
  { label: 'Замовлень, к-сть', get: (d) => d.ordersCount },
  { label: 'Продано товарів, к-сть', get: (d) => d.qtySold },
  { label: 'Повторно продані товари', get: (d) => d.qtyRepeat },
  { label: 'Кліки', get: (d) => d.clicks },
  { label: 'Покази', get: (d) => d.impressions },
  { label: 'Окупність', get: (d) => fmt(d.roi), highlight: true, sep: true },
  { label: 'Окупність із прогнозованими відмовами', get: (d) => fmt(d.roiForecast), highlight: true },
  { label: 'Очікуваний прибуток, грн', money: true, val: (d) => d.expectedProfit, highlight: true },
  { label: 'Курс долара, грн', edit: 'usdRate', sep: true },
  { label: 'Відсоток відмов, %', get: (d) => pct(d.refusalRate) },
  { label: 'Відсоток відмов прогнозований, %', edit: 'refusalPct' },
  { label: 'Відсоток повернень, %', get: (d) => pct(d.returnRate) },
  { label: 'Відсоток повернень прогнозований, %', edit: 'returnPct' },
  { label: 'Постійні витрати, грн', edit: 'fixedCosts' },
  { label: 'Витрати на оплату праці, грн', edit: 'payrollCosts' },
  { label: 'Витрати на токени Claude, грн', money: true, val: (d) => d.aiCost },
  { label: 'Прибуток без ЗП, грн', money: true, val: (d) => d.profitNoPayroll },
  { label: 'Ціна клієнта нового, грн', money: true, val: (d) => d.newCustomerCost },
  { label: 'CPC (ціна за клік)', money: true, val: (d) => d.cpc },
  { label: 'CTR (кліків зі 100 показів)', get: (d) => pct(d.ctr) },
  { label: 'CPM (ціна 1000 показів)', money: true, val: (d) => d.cpm },
  { label: 'Повторних продажів, %', get: (d) => pct(d.repeatSalesRate) },
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
  const [cur, setCur] = useCurrency(); // грн/$ (Edits 06.11: «додати перемикач гривні-долари»); вибір пам'ятається в браузері

  useEffect(() => { api.listProducts().then((r) => setProducts(r.data)).catch(() => {}); }, []);

  const load = () => {
    setError('');
    if (tab === 'summary') {
      api.analyticsDaily(range).then((r) => setSummary(r.data)).catch((e) => setError(e.message));
    } else if (productId) {
      api.analyticsProductDaily({ ...range, productId }).then((r) => setProductDaily(r.data)).catch((e) => setError(e.message));
    }
  };
  useEffect(load, [tab, range.from, range.to, productId]);

  const summaryDays = (summary || []).slice().reverse(); // новий день — лівіша колонка
  const productDays = (productDaily || []).slice().reverse();

  return (
    <div>
      <PageHeader
        title="Щоденна аналітика"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {tab === 'summary' && <CurrencyToggle cur={cur} setCur={setCur} usdRate={summary && summary.length ? summary[summary.length - 1].usdExchangeRate : null} />}
            {['summary', 'product'].map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-xs ${tab === t ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300'}`}>
                {t === 'summary' ? 'Загальне зведення' : 'По товару'}
              </button>
            ))}
          </div>
        }
      />
      <ErrorBanner message={error} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['today', 'week', 'month'].map((p) => (
          <button key={p} onClick={() => setRange(periodPreset(p))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs hover:border-brand">
            {{ today: 'Сьогодні', week: 'Тиждень', month: 'Місяць' }[p]}
          </button>
        ))}
        <Input type="date" className="!w-auto" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-slate-500">—</span>
        <Input type="date" className="!w-auto" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
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
              <MetricsTable days={summaryDays} rows={SUMMARY_ROWS} onSaved={load} cur={cur} />
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
    </div>
  );
}
