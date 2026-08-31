// "Рука на пульсі" — щоденне зведення (весь tenant) + по товару, за зразком таблиць користувача.
// Одна картка = один день, той самий порядок міток, що в оригінальній Google Sheets.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Input, Select, ErrorBanner } from '../components/common/Common';

function periodPreset(preset) {
  const to = new Date();
  const from = new Date();
  if (preset === 'today') { /* from=to=сьогодні */ }
  else if (preset === 'week') from.setDate(to.getDate() - 7);
  else if (preset === 'month') from.setDate(to.getDate() - 30);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function fmt(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(v) { return v === null || v === undefined ? '—' : `${fmt(v, 1)}%`; }
function usd(v) { return v === null || v === undefined || Number.isNaN(v) ? '—' : `$${fmt(v)}`; }

function Row({ label, value, highlight }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${highlight ? 'font-semibold text-brand-light' : ''}`}>
      <span className="text-slate-400">{label}</span>
      <span>{value}</span>
    </div>
  );
}

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(summary || []).length === 0 && summary !== null && <Card className="p-5 text-sm text-slate-500">Даних за період немає.</Card>}
          {(summary || []).slice().reverse().map((d) => (
            <Card key={d.date} className="p-4">
              <h3 className="mb-2 border-b border-slate-800 pb-2 text-sm font-semibold">{new Date(d.date).toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
              <Row label="Маржа ср. без відмов, $" value={fmt(d.marginAvgNonRefused)} />
              <Row label="Маржа ср. з відмовами, $" value={fmt(d.marginAvgWithRefused)} />
              <Row label="Ціна замовлення, $" value={fmt(d.orderPrice)} />
              <Row label="Прибуток з клієнта без ЗП, $" value={fmt(d.profitPerClientNoPayroll)} />
              <Row label="Прибуток з клієнта із ЗП, $" value={fmt(d.profitPerClientWithPayroll)} />
              <Row label="Ціна повідомлення, $" value={fmt(d.messagePrice)} />
              <Row label="Конверсія у продаж, %" value={pct(d.conversionToSale !== null ? d.conversionToSale * 100 : null)} />
              <div className="my-2 border-t border-slate-800" />
              <Row label="Маржа всього, $" value={usd(d.marginTotal)} />
              <Row label="Рекламний бюджет, $" value={usd(d.adSpend)} />
              <Row label="Нові контакти в повідомленнях" value={d.newMessages} />
              <Row label="Продано товарів, к-сть" value={d.qtySold} />
              <Row label="Повторно продані товари" value={d.qtyRepeat} />
              <Row label="Кліки" value={d.clicks} />
              <Row label="Покази" value={d.impressions} />
              <div className="my-2 border-t border-slate-800" />
              <Row label="Окупність" value={fmt(d.roi)} highlight />
              <Row label="Очікуваний прибуток, $" value={usd(d.expectedProfit)} highlight />
              <div className="my-2 border-t border-slate-800" />
              <Row label="Курс доллара, грн" value={fmt(d.usdExchangeRate, 2)} />
              <Row label="Відсоток відмов, %" value={pct(d.refusalRate)} />
              <Row label="Відсоток повернень, %" value={pct(d.returnRate)} />
              <Row label="Постійні витрати, $" value={fmt(d.dailyFixedCosts)} />
              <Row label="Витрати на оплату праці, $" value={fmt(d.dailyPayrollCosts)} />
              <Row label="Прибуток без ЗП, $" value={usd(d.profitNoPayroll)} />
              <Row label="Ціна клієнта нового, $" value={fmt(d.newCustomerCost)} />
              <Row label="CPC (ціна за клік)" value={fmt(d.cpc)} />
              <Row label="CTR (кліків зі 100 показів)" value={pct(d.ctr)} />
              <Row label="CPM (ціна 1000 показів)" value={fmt(d.cpm)} />
              <Row label="Повторних продажів, %" value={pct(d.repeatSalesRate)} />
            </Card>
          ))}
        </div>
      )}

      {tab === 'product' && (
        !productId ? (
          <Card className="p-5 text-sm text-slate-500">Оберіть товар вище.</Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(productDaily || []).length === 0 && productDaily !== null && <Card className="p-5 text-sm text-slate-500">Даних за період немає.</Card>}
            {(productDaily || []).slice().reverse().map((d) => (
              <Card key={d.date} className="p-4">
                <h3 className="mb-2 border-b border-slate-800 pb-2 text-sm font-semibold">{new Date(d.date).toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
                <Row label="Реклама, дол" value={usd(d.adSpend)} />
                <Row label="Повідомлень з реклам" value={d.messages} />
                <Row label="Замовлень (шт)" value={d.ordersCount} />
                <Row label="Маржа із замовлення" value={fmt(d.marginPerOrder)} />
                <Row label="Маржа всього" value={usd(d.marginTotal)} />
                <Row label="Маржа всього із відмовами" value={usd(d.marginTotalWithRefused)} />
                <Row label="Ціна за лід" value={fmt(d.messagePrice)} />
                <Row label="Ціна за замовлення" value={fmt(d.orderPrice)} />
                <Row label="Конверсія із повідом. в замов" value={fmt(d.conversionToOrder)} />
                <Row label="Відмови" value={pct(d.refusalRate)} />
                <Row label="Курс" value={fmt(d.usdExchangeRate, 0)} />
                <div className="my-2 border-t border-slate-800" />
                <Row label="Окупність" value={fmt(d.roi)} highlight />
                <Row label="Прибуток" value={usd(d.profit)} highlight />
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
