// §9.12 Дашборд аналітики — спільний фільтр періоду + 5 блоків-карток на сітці 2 колонки.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Input, Card, ErrorBanner, money } from '../components/common/Common';

function periodPreset(preset) {
  const to = new Date();
  const from = new Date();
  if (preset === 'day') from.setDate(to.getDate() - 1);
  else if (preset === 'week') from.setDate(to.getDate() - 7);
  else if (preset === 'month') from.setMonth(to.getMonth() - 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function AnalyticsPage() {
  const [range, setRange] = useState(periodPreset('month'));
  const [includeUpsells, setIncludeUpsells] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const params = { from: range.from, to: range.to };
      const [top, ads, margin, upsells, ttp] = await Promise.all([
        api.analyticsTopProducts({ ...params, includeUpsells }),
        api.analyticsAdsConversion(params),
        api.analyticsMargin(params),
        api.analyticsUpsells(params),
        api.analyticsTimeToPurchase(params),
      ]);
      setData({ top: top.data, ads: ads.data, margin: margin.data, upsells: upsells.data, ttp: ttp.data });
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [range.from, range.to, includeUpsells]);

  return (
    <div>
      <PageHeader title="Дашборд аналітики" />
      <ErrorBanner message={error} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['day', 'week', 'month'].map((p) => (
          <button key={p} onClick={() => setRange(periodPreset(p))} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs hover:border-brand">
            {{ day: 'День', week: 'Тиждень', month: 'Місяць' }[p]}
          </button>
        ))}
        <Input type="date" className="!w-auto" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <span className="text-slate-500">—</span>
        <Input type="date" className="!w-auto" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={includeUpsells} onChange={(e) => setIncludeUpsells(e.target.checked)} /> включно з допродажами
        </label>
      </div>

      {!data ? null : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Топ товарів за продажами</h3>
            <BarList items={data.top.slice(0, 10).map((t) => ({ label: t.name, value: t.revenue, sub: `${t.quantity} шт.` }))} />
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Реклама: кліки → покупки</h3>
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="pb-1 text-left">Оголошення</th><th className="pb-1 text-right">Кліки</th><th className="pb-1 text-right">First</th><th className="pb-1 text-right">Last</th><th className="pb-1 text-right">Витрата</th></tr></thead>
              <tbody>
                {data.ads.slice(0, 10).map((a) => (
                  <tr key={a.adId} className="border-t border-slate-800/60"><td className="py-1">{a.name}</td><td className="py-1 text-right">{a.clicks}</td><td className="py-1 text-right">{a.purchasesFirstTouch}</td><td className="py-1 text-right">{a.purchasesLastTouch}</td><td className="py-1 text-right">{money(a.spend)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Маржа по товару</h3>
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="pb-1 text-left">Товар</th><th className="pb-1 text-right">Дохід</th><th className="pb-1 text-right">Маржа</th><th className="pb-1 text-right">%</th></tr></thead>
              <tbody>
                {data.margin.slice(0, 10).map((m) => (
                  <tr key={m.productId} className="border-t border-slate-800/60"><td className="py-1">{m.name}</td><td className="py-1 text-right">{money(m.revenue)}</td><td className="py-1 text-right">{money(m.margin)}</td><td className="py-1 text-right">{m.marginPercent?.toFixed(0)}%</td></tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Допродажі</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="mb-1 text-slate-500">Найчастіше докуповують X → Y</div>
                {data.upsells.topPairs.slice(0, 6).map((p, i) => <div key={i} className="py-0.5">{p.mainName} → {p.upsellName} ({p.count})</div>)}
              </div>
              <div>
                <div className="mb-1 text-slate-500">Найкраще допродається</div>
                {data.upsells.acceptance.slice(0, 6).map((a) => <div key={a.productId} className="py-0.5">{a.name} — {a.acceptanceRate.toFixed(0)}%</div>)}
              </div>
            </div>
          </Card>

          <Card className="p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold">Середній час клік → покупка</h3>
            <div className="mb-3 text-sm text-slate-300">
              Загалом: {fmtMinutes(data.ttp.overall.avgMinutes)} (медіана {fmtMinutes(data.ttp.overall.medianMinutes)}), n={data.ttp.overall.count}
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="mb-1 text-slate-500">По товару</div>
                {data.ttp.byProduct.slice(0, 6).map((r) => <div key={r.key} className="py-0.5">{r.key} — {fmtMinutes(r.avgMinutes)}</div>)}
              </div>
              <div>
                <div className="mb-1 text-slate-500">По рекламі</div>
                {data.ttp.byAd.slice(0, 6).map((r) => <div key={r.key} className="py-0.5">{r.key || '—'} — {fmtMinutes(r.avgMinutes)}</div>)}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function fmtMinutes(m) {
  if (m == null) return '—';
  if (m < 60) return `${m.toFixed(0)} хв`;
  if (m < 1440) return `${(m / 60).toFixed(1)} год`;
  return `${(m / 1440).toFixed(1)} дн`;
}

function BarList({ items }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-0.5 flex justify-between text-xs"><span>{i.label}</span><span className="text-slate-500">{i.sub} · {money(i.value)}</span></div>
          <div className="h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-brand" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
