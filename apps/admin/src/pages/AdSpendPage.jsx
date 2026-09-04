// «Рекламні витрати» — редизайн 2026-09-03 за референсом власника: список оголошень
// (не голий журнал дата×сума), кожне оголошення один раз, з витратою/замовленнями/
// окупністю/прибутком за обраний період і переходом на детальну сторінку (AdSpendDetailPage).
// Уся маржа фактичного кошика замовлення зараховується оголошенню, яке привело клієнта
// (firstTouchAdId) — рахунок на бекенді, apps/api/src/routes/ads.js computeAdStats().
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHeader, Card, Input, Select, EmptyState, ErrorBanner, KpiCard, Badge, Pagination, money } from '../components/common/Common';

function periodPreset(preset) {
  const to = new Date();
  const from = new Date();
  if (preset === 'today') { /* from=to=сьогодні */ }
  else if (preset === 'yesterday') { from.setDate(to.getDate() - 1); to.setDate(to.getDate() - 1); }
  else if (preset === 'week') from.setDate(to.getDate() - 7);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function AdSpendPage() {
  const [preset, setPreset] = useState('week');
  const [range, setRange] = useState(periodPreset('week'));
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [items, setItems] = useState(null);
  const [totals, setTotals] = useState(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const { data, meta, totals: t } = await api.getAdSpendSummary({ ...range, search, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE });
      setItems(data); setTotal(meta.total); setTotals(t);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [range.from, range.to, search, page]);
  useEffect(() => { setPage(1); }, [search, range.from, range.to]);

  const filtered = (items || []).filter((ad) => {
    if (filter === 'linked') return !!ad.productId;
    if (filter === 'unlinked') return !ad.productId;
    return true;
  });
  return (
    <div>
      <PageHeader title="Рекламні оголошення" />
      <ErrorBanner message={error} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['today', 'yesterday', 'week'].map((p) => (
          <button key={p} onClick={() => { setPreset(p); setRange(periodPreset(p)); }} className={`rounded-lg border px-3 py-1.5 text-xs ${preset === p ? 'border-brand bg-brand/10 text-brand-light' : 'border-slate-700 bg-slate-800 hover:border-brand'}`}>
            {{ today: 'Сьогодні', yesterday: 'Вчора', week: '7 днів' }[p]}
          </button>
        ))}
        <Input type="date" className="!w-auto" value={range.from} onChange={(e) => { setPreset('custom'); setRange({ ...range, from: e.target.value }); }} />
        <span className="text-slate-500">—</span>
        <Input type="date" className="!w-auto" value={range.to} onChange={(e) => { setPreset('custom'); setRange({ ...range, to: e.target.value }); }} />
      </div>

      {totals && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Активні оголошення" value={totals.activeAds} />
          <KpiCard label="Загальні витрати" value={money(totals.spend)} />
          <KpiCard label="Замовлення" value={totals.orders} />
          <KpiCard label="Загальна окупність" value={totals.roi !== null ? `×${totals.roi.toFixed(2)}` : '—'} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Пошук за назвою або ad_id" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Усі оголошення</option>
          <option value="linked">З привʼязаним товаром</option>
          <option value="unlinked">Без товару</option>
        </Select>
      </div>

      {items === null ? null : filtered.length === 0 ? (
        <EmptyState title="Оголошень ще немає" hint="Дані підтягнуться автоматично, щойно запрацює синхронізація реклами (сторінка «Оголошення»)." />
      ) : (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3">Назва рекламного оголошення</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3 text-right">Витрати</th>
                  <th className="px-4 py-3 text-right">Замовлення</th>
                  <th className="px-4 py-3 text-right">Ціна за замовлення</th>
                  <th className="px-4 py-3 text-right">Окупність</th>
                  <th className="px-4 py-3 text-right">Прибуток</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ad) => (
                  <tr key={ad.id} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-3">
                      {ad.thumbnailUrl
                        ? <img src={ad.thumbnailUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                        : <div className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div>{ad.name || ad.externalId || ad.id.slice(0, 8)}</div>
                      {ad.productName && <div className="text-xs text-slate-500">{ad.productName}</div>}
                    </td>
                    <td className="px-4 py-3">{ad.spend > 0 ? <Badge color="green">Активне</Badge> : <Badge>Без витрат</Badge>}</td>
                    <td className="px-4 py-3 text-right">{money(ad.spend)}</td>
                    <td className="px-4 py-3 text-right">{ad.ordersCreated}</td>
                    <td className="px-4 py-3 text-right">{ad.cpa !== null ? money(ad.cpa) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {ad.roi !== null ? <Badge color={ad.roi >= 1 ? 'green' : 'red'}>×{ad.roi.toFixed(2)}</Badge> : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${ad.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{money(ad.profit)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/ad-spend/${ad.id}?from=${range.from}&to=${range.to}`} className="text-xs text-brand-light hover:underline">Детальна інформація</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
