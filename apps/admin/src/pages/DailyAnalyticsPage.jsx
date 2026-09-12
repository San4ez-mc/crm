// "Рука на пульсі" — щоденне зведення (весь tenant) + по товару, за зразком таблиць користувача.
// 2026-09-03: картки-по-дню замінено на таблицю (показник — рядок, день — колонка) за проханням
// власника — так природніше порівнювати кілька днів одразу, а не гортати картки. Перша колонка
// (назви показників) приклеєна (`sticky left-0`) — лишається видимою при горизонтальному скролі
// вправо по днях.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Input, Select, ErrorBanner, TrendChart, money, formatDate, kyivDateStr } from '../components/common/Common';

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
function MetricsTable({ days, rows }) {
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
              <td className={`sticky left-0 z-10 border-r border-slate-800 bg-slate-900 px-3 py-1.5 text-xs whitespace-nowrap ${row.highlight ? 'font-semibold text-brand-light' : 'text-slate-400'}`}>{row.label}</td>
              {days.map((d) => (
                <td key={d.date} className={`px-3 py-1.5 text-right text-xs whitespace-nowrap ${row.highlight ? 'font-semibold text-brand-light' : 'text-slate-200'}`}>{row.get(d)}</td>
              ))}
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
const SUMMARY_ROWS = [
  { label: 'Маржа ср. без відмов, грн', get: (d) => fmt(d.marginAvgNonRefused) },
  { label: 'Маржа ср. з відмовами, грн', get: (d) => fmt(d.marginAvgWithRefused) },
  { label: 'Ціна замовлення, грн', get: (d) => fmt(d.orderPrice) },
  { label: 'Прибуток з клієнта без ЗП, грн', get: (d) => fmt(d.profitPerClientNoPayroll) },
  { label: 'Прибуток з клієнта із ЗП, грн', get: (d) => fmt(d.profitPerClientWithPayroll) },
  { label: 'Ціна повідомлення, грн', get: (d) => fmt(d.messagePrice) },
  { label: 'Конверсія у продаж, %', get: (d) => pct(d.conversionToSale !== null ? d.conversionToSale * 100 : null) },
  { label: 'Маржа всього, грн', get: (d) => fmt(d.marginTotal), sep: true },
  { label: 'Рекламний бюджет, грн', get: (d) => fmt(d.adSpend) },
  { label: 'Рекламний бюджет, $ (як з Meta)', get: (d) => (d.adSpendUsd === null ? '—' : `$${fmt(d.adSpendUsd)}`) },
  { label: 'Нові контакти в повідомленнях', get: (d) => d.newMessages },
  { label: 'Продано товарів, к-сть', get: (d) => d.qtySold },
  { label: 'Повторно продані товари', get: (d) => d.qtyRepeat },
  { label: 'Кліки', get: (d) => d.clicks },
  { label: 'Покази', get: (d) => d.impressions },
  { label: 'Окупність', get: (d) => fmt(d.roi), highlight: true, sep: true },
  { label: 'Очікуваний прибуток, грн', get: (d) => fmt(d.expectedProfit), highlight: true },
  { label: 'Курс долара, грн', get: (d) => fmt(d.usdExchangeRate, 2), sep: true },
  { label: 'Відсоток відмов, %', get: (d) => pct(d.refusalRate) },
  { label: 'Відсоток повернень, %', get: (d) => pct(d.returnRate) },
  { label: 'Постійні витрати, грн', get: (d) => fmt(d.dailyFixedCosts) },
  { label: 'Витрати на оплату праці, грн', get: (d) => fmt(d.dailyPayrollCosts) },
  { label: 'Прибуток без ЗП, грн', get: (d) => fmt(d.profitNoPayroll) },
  { label: 'Ціна клієнта нового, грн', get: (d) => fmt(d.newCustomerCost) },
  { label: 'CPC (ціна за клік)', get: (d) => fmt(d.cpc) },
  { label: 'CTR (кліків зі 100 показів)', get: (d) => pct(d.ctr) },
  { label: 'CPM (ціна 1000 показів)', get: (d) => fmt(d.cpm) },
  { label: 'Повторних продажів, %', get: (d) => pct(d.repeatSalesRate) },
];

const PRODUCT_ROWS = [
  { label: 'Реклама, грн', get: (d) => fmt(d.adSpend) },
  { label: 'Повідомлень з реклам', get: (d) => d.messages },
  { label: 'Замовлень (шт)', get: (d) => d.ordersCount },
  { label: 'Маржа із замовлення', get: (d) => fmt(d.marginPerOrder) },
  { label: 'Маржа всього', get: (d) => fmt(d.marginTotal) },
  { label: 'Маржа всього із відмовами', get: (d) => fmt(d.marginTotalWithRefused) },
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

  useEffect(() => { api.listProducts().then((r) => setProducts(r.data)).catch(() => {}); }, []);

  useEffect(() => {
    setError('');
    if (tab === 'summary') {
      api.analyticsDaily(range).then((r) => setSummary(r.data)).catch((e) => setError(e.message));
    } else if (productId) {
      api.analyticsProductDaily({ ...range, productId }).then((r) => setProductDaily(r.data)).catch((e) => setError(e.message));
    }
  }, [tab, range.from, range.to, productId]);

  const summaryDays = (summary || []).slice().reverse(); // новий день — лівіша колонка
  const productDays = (productDaily || []).slice().reverse();

  return (
    <div>
      <PageHeader
        title="Щоденна аналітика"
        action={
          <div className="flex gap-2">
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
              <TrendChart data={summary} valueKey="expectedProfit" formatValue={(v) => money(v)} />
            </Card>
          )}
          {summaryDays.length === 0 ? (
            <Card className="p-5 text-sm text-slate-500">Даних за період немає.</Card>
          ) : (
            <MetricsTable days={summaryDays} rows={SUMMARY_ROWS} />
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
