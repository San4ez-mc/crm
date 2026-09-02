// §9.12 Дашборд аналітики — редизайн 2026-09-02 як "кокпіт власника": спершу цифри, які
// цікавлять першими (скільки заробили, чи росте це), потім деталізація (що продається,
// що працює в рекламі), найдетальніше (допродажі, час до покупки) — внизу, воно вже
// не для щоденного погляду, а для рідкісного глибокого аналізу.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Input, Card, ErrorBanner, KpiCard, TrendChart, money } from '../components/common/Common';

function periodPreset(preset) {
  const to = new Date();
  const from = new Date();
  if (preset === 'day') from.setDate(to.getDate() - 1);
  else if (preset === 'week') from.setDate(to.getDate() - 7);
  else if (preset === 'month') from.setMonth(to.getMonth() - 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

// Попередній період тієї ж довжини, що йде впритул ПЕРЕД поточним — для "▲/▼ % від попереднього".
function previousPeriod(range) {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const days = Math.max(1, Math.round((to - from) / 86400000));
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - days * 86400000);
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

function sumDaily(days) {
  return days.reduce((acc, d) => {
    acc.margin += d.marginTotal || 0;
    acc.adSpend += d.adSpend || 0;
    acc.profit += d.expectedProfit || 0;
    acc.orders += d.ordersCount || 0;
    return acc;
  }, { margin: 0, adSpend: 0, profit: 0, orders: 0 });
}

function deltaPct(cur, prev) {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / Math.abs(prev)) * 100;
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
      const prevRange = previousPeriod(range);
      const [top, prevTop, ads, margin, upsells, ttp, daily, prevDaily] = await Promise.all([
        api.analyticsTopProducts({ ...params, includeUpsells }),
        api.analyticsTopProducts({ ...prevRange, includeUpsells }),
        api.analyticsAdsConversion(params),
        api.analyticsMargin(params),
        api.analyticsUpsells(params),
        api.analyticsTimeToPurchase(params),
        api.analyticsDaily(params),
        api.analyticsDaily(prevRange),
      ]);

      const revenue = top.data.reduce((s, t) => s + t.revenue, 0);
      const prevRevenue = prevTop.data.reduce((s, t) => s + t.revenue, 0);
      const cur = sumDaily(daily.data);
      const prev = sumDaily(prevDaily.data);
      const roi = cur.adSpend > 0 ? cur.margin / cur.adSpend : null;
      const prevRoi = prev.adSpend > 0 ? prev.margin / prev.adSpend : null;

      // Товари: виручка+кількість з top-products (враховує чекбокс "включно з допродажами"),
      // маржа/маржа% доклеюємо з /analytics/margin по productId (margin завжди рахує з допродажами).
      const marginByProduct = new Map(margin.data.map((m) => [m.productId, m]));
      const products = top.data.map((t) => ({ ...t, margin: marginByProduct.get(t.productId)?.margin ?? null, marginPercent: marginByProduct.get(t.productId)?.marginPercent ?? null }));

      setData({
        kpi: { revenue, prevRevenue, ...cur, prevMargin: prev.margin, prevAdSpend: prev.adSpend, prevProfit: prev.profit, prevOrders: prev.orders, roi, prevRoi },
        trend: daily.data,
        products,
        ads: ads.data,
        upsells: upsells.data,
        ttp: ttp.data,
      });
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
        <div className="space-y-5">
          {/* 1. Скільки заробили і чи це росте — перше, що цікавить власника */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard label="Виручка" value={money(data.kpi.revenue)} delta={deltaPct(data.kpi.revenue, data.kpi.prevRevenue)} deltaGood="up" />
            <KpiCard label="Маржа" value={money(data.kpi.margin)} delta={deltaPct(data.kpi.margin, data.kpi.prevMargin)} deltaGood="up" />
            <KpiCard label="Рекламний бюджет" value={money(data.kpi.adSpend)} delta={deltaPct(data.kpi.adSpend, data.kpi.prevAdSpend)} deltaGood="neutral" />
            <KpiCard label="Прибуток" value={money(data.kpi.profit)} delta={deltaPct(data.kpi.profit, data.kpi.prevProfit)} deltaGood="up" />
            <KpiCard label="Замовлень" value={data.kpi.orders} delta={deltaPct(data.kpi.orders, data.kpi.prevOrders)} deltaGood="up" />
            <KpiCard label="Окупність (ROI)" value={data.kpi.roi !== null ? `×${data.kpi.roi.toFixed(2)}` : '—'} delta={deltaPct(data.kpi.roi || 0, data.kpi.prevRoi || 0)} deltaGood="up" />
          </div>

          {/* 2. Чи росте прибуток день у день — тренд одразу під цифрами, поки вони ще на екрані */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Прибуток по днях <span className="font-normal text-slate-500">(після реклами, постійних витрат і ЗП)</span></h3>
            <TrendChart data={data.trend} valueKey="expectedProfit" formatValue={(v) => money(v)} />
          </Card>

          {/* 3. Що продається і наскільки прибутково — топ товарів і маржа в одній таблиці */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Товари: виручка і маржа</h3>
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="pb-1 text-left">Товар</th><th className="pb-1 text-right">К-сть</th><th className="pb-1 text-right">Виручка</th><th className="pb-1 text-right">Маржа</th><th className="pb-1 text-right">Маржа %</th></tr></thead>
              <tbody>
                {data.products.slice(0, 10).map((p) => (
                  <tr key={p.productId || p.name} className="border-t border-slate-800/60">
                    <td className="py-1">{p.name}</td>
                    <td className="py-1 text-right">{p.quantity}</td>
                    <td className="py-1 text-right">{money(p.revenue)}</td>
                    <td className="py-1 text-right">{p.margin !== null ? money(p.margin) : '—'}</td>
                    <td className="py-1 text-right">{p.marginPercent !== null ? `${p.marginPercent.toFixed(0)}%` : '—'}</td>
                  </tr>
                ))}
                {data.products.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-slate-500">Даних за період немає.</td></tr>}
              </tbody>
            </table>
          </Card>

          {/* 4. Що працює в рекламі — витрата, ROAS, CTR/CPC поруч, щоб бачити де гроші горять даремно */}
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Реклама: витрата → покупки</h3>
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="pb-1 text-left">Оголошення</th><th className="pb-1 text-right">Витрата</th><th className="pb-1 text-right">Покупки</th><th className="pb-1 text-right">ROAS</th><th className="pb-1 text-right">CTR</th><th className="pb-1 text-right">CPC</th></tr></thead>
              <tbody>
                {data.ads.slice(0, 10).map((a) => (
                  <tr key={a.adId} className="border-t border-slate-800/60">
                    <td className="py-1">{a.name}</td>
                    <td className="py-1 text-right">{money(a.spend)}</td>
                    <td className="py-1 text-right">{a.purchasesFirstTouch}</td>
                    <td className="py-1 text-right">{a.roas !== null ? `×${a.roas.toFixed(1)}` : '—'}</td>
                    <td className="py-1 text-right">{a.ctr !== null ? `${a.ctr.toFixed(1)}%` : '—'}</td>
                    <td className="py-1 text-right">{a.cpc !== null ? money(a.cpc) : '—'}</td>
                  </tr>
                ))}
                {data.ads.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-500">Оголошень ще немає.</td></tr>}
              </tbody>
            </table>
          </Card>

          {/* 5. Глибша аналітика — цікаво подивитись, але не щодня: допродажі і час до покупки */}
          <details className="rounded-xl border border-slate-800 bg-slate-900">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-300">Детальніше: допродажі та час клік → покупка</summary>
            <div className="grid grid-cols-1 gap-4 p-4 pt-0 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold text-slate-400">Допродажі</h4>
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
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold text-slate-400">Середній час клік → покупка</h4>
                <div className="mb-2 text-sm text-slate-300">
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
              </div>
            </div>
          </details>
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
