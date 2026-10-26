// «Рекламні витрати» — редизайн 2026-09-03 за референсом власника: список оголошень
// (не голий журнал дата×сума), кожне оголошення один раз, з витратою/замовленнями/
// окупністю/прибутком за обраний період і переходом на детальну сторінку (AdSpendDetailPage).
// Уся маржа фактичного кошика замовлення зараховується оголошенню, яке привело клієнта
// (firstTouchAdId) — рахунок на бекенді, apps/api/src/routes/ads.js computeAdStats().
// 2026-10-26 (Олексій, Edits 55e6794d/11ab6f97/6194e8b9 + план Б11): кількість рядків, сортування за колонкою (на сервері — до
// пагінації), без оголошень, де за період нічого нема, ID оголошення з копіюванням, гривня/долар, вкладка «По товарах».
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHeader, Card, Input, Select, EmptyState, ErrorBanner, KpiCard, Badge, Pagination, kyivDateStr } from '../components/common/Common';
import { useCurrency, fmtMoney, CurrencyToggle } from '../components/common/Currency';

// 2026-09-12 (аудит аналітики): "сьогодні"/"вчора" — за київським часом, не UTC (toISOString()).
function periodPreset(preset) {
  const to = new Date();
  const from = new Date();
  if (preset === 'today') { /* from=to=сьогодні */ }
  else if (preset === 'yesterday') { from.setDate(to.getDate() - 1); to.setDate(to.getDate() - 1); }
  else if (preset === 'week') from.setDate(to.getDate() - 7);
  else if (preset === 'month') from.setDate(to.getDate() - 30);
  return { from: kyivDateStr(from), to: kyivDateStr(to) };
}

// ID оголошення в Meta — скопіювати й знайти в Ads Manager (Edits 11ab6f97).
function AdIdCopy({ id }) {
  const [done, setDone] = useState(false);
  if (!id) return null;
  return (
    <button type="button" title="Скопіювати ID оголошення" className="text-[11px] text-slate-500 hover:text-brand-light"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(String(id)).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      ID {id} {done ? '✓ скопійовано' : '⧉'}
    </button>
  );
}

const COLS = [
  { key: 'spend', label: 'Витрати' },
  { key: 'contacts', label: 'Розмови', title: 'Розмови в Instagram, які почались із цієї реклами' },
  { key: 'orders', label: 'Замовлення', title: 'Оформлені замовлення (є телефон покупця), перший дотик — ця реклама' },
  { key: 'cpa', label: 'Ціна за замовлення' },
  { key: 'roi', label: 'Окупність' },
  { key: 'profit', label: 'Прибуток' },
];

export default function AdSpendPage() {
  const [preset, setPreset] = useState('week');
  const [range, setRange] = useState(periodPreset('week'));
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [group, setGroup] = useState('post'); // post — оголошення (просування одного допису разом), product — по товарах
  const [sort, setSort] = useState({ key: 'spend', dir: 'desc' });
  const [showEmpty, setShowEmpty] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => { try { return Number(localStorage.getItem('crm.adSpend.pageSize')) || 10; } catch (e) { return 10; } });
  const [items, setItems] = useState(null);
  const [totals, setTotals] = useState(null);
  const [total, setTotal] = useState(0);
  const [usdRate, setUsdRate] = useState(0);
  const [error, setError] = useState('');
  const [cur, setCur] = useCurrency();
  const m = (v) => fmtMoney(v, cur, usdRate);

  async function load() {
    setError('');
    try {
      // 2026-09-12 (аудит аналітики): фільтр "linked" тепер іде на бекенд — раніше фільтрувався
      // лише вже завантажений шматок сторінки на фронті, і total/пагінація з ним розходились.
      const linked = filter === 'linked' ? 'true' : filter === 'unlinked' ? 'false' : undefined;
      const { data, meta, totals: t } = await api.getAdSpendSummary({
        ...range, search, ...(linked !== undefined ? { linked } : {}), ...(group === 'product' ? { group: 'product' } : {}),
        sort: sort.key, dir: sort.dir, ...(showEmpty ? { showEmpty: '1' } : {}), take: pageSize, skip: (page - 1) * pageSize,
      });
      setItems(data); setTotal(meta.total); setTotals(t); setUsdRate(meta.usdRate || 0);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [range.from, range.to, search, filter, group, sort.key, sort.dir, showEmpty, page, pageSize]);
  useEffect(() => { setPage(1); }, [search, filter, group, sort.key, sort.dir, showEmpty, pageSize, range.from, range.to]);

  function sortBy(key) { setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' })); }
  function setSize(n) { setPageSize(n); try { localStorage.setItem('crm.adSpend.pageSize', String(n)); } catch (e) { /* лише цей перегляд */ } }
  const byProduct = group === 'product';

  return (
    <div>
      <PageHeader title="Рекламні оголошення" action={<CurrencyToggle cur={cur} setCur={setCur} usdRate={usdRate} />} />
      <ErrorBanner message={error} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {['today', 'yesterday', 'week', 'month'].map((p) => (
          <button key={p} onClick={() => { setPreset(p); setRange(periodPreset(p)); }} className={`rounded-lg border px-3 py-1.5 text-xs ${preset === p ? 'border-brand bg-brand/10 text-brand-light' : 'border-slate-700 bg-slate-800 hover:border-brand'}`}>
            {{ today: 'Сьогодні', yesterday: 'Вчора', week: '7 днів', month: '30 днів' }[p]}
          </button>
        ))}
        <Input type="date" className="!w-auto" value={range.from} onChange={(e) => { setPreset('custom'); setRange({ ...range, from: e.target.value }); }} />
        <span className="text-slate-500">—</span>
        <Input type="date" className="!w-auto" value={range.to} onChange={(e) => { setPreset('custom'); setRange({ ...range, to: e.target.value }); }} />
      </div>

      {totals && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Активні оголошення" value={totals.activeAds} />
          <KpiCard label="Загальні витрати" value={m(totals.spend)} />
          <KpiCard label="Замовлення" value={totals.orders} />
          <KpiCard label="Загальна окупність" value={totals.roi !== null ? `×${totals.roi.toFixed(2)}` : '—'} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
          {[['post', 'По оголошеннях'], ['product', 'По товарах']].map(([g, label]) => (
            <button key={g} type="button" onClick={() => setGroup(g)} className={`px-3 py-1.5 text-xs ${group === g ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{label}</button>
          ))}
        </div>
        <Select className="!w-auto" value={pageSize} onChange={(e) => setSize(Number(e.target.value))} title="Рядків на сторінці">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} рядків</option>)}
        </Select>
        {!byProduct && <Input className="max-w-xs" placeholder="Пошук за назвою або ID оголошення" value={search} onChange={(e) => setSearch(e.target.value)} />}
        {!byProduct && (
          <Select className="max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Усі оголошення</option>
            <option value="linked">З привʼязаним товаром</option>
            <option value="unlinked">Без товару</option>
          </Select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-400" title="За замовчуванням ховаємо оголошення, де за період немає ні витрат, ні розмов, ні замовлень">
          <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> показати й без витрат
        </label>
      </div>

      {items === null ? null : items.length === 0 ? (
        <EmptyState title="За цей період оголошень з витратами немає" hint="Змініть період або увімкніть «показати й без витрат»." />
      ) : (
        <>
          <Card>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3"></th>
                  <th className="px-4 py-3">{byProduct ? 'Товар' : 'Назва рекламного оголошення'}</th>
                  <th className="px-4 py-3">{byProduct ? 'Оголошень' : 'Статус'}</th>
                  {COLS.map((c) => (
                    <th key={c.key} className="px-4 py-3 text-right" title={c.title}>
                      <button type="button" onClick={() => sortBy(c.key)} className={`inline-flex items-center gap-1 uppercase hover:text-slate-300 ${sort.key === c.key ? 'text-brand-light' : ''}`}>
                        {c.label}<span className="text-[10px]">{sort.key === c.key ? (sort.dir === 'desc' ? '▼' : '▲') : '⇅'}</span>
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((ad) => (
                  <tr key={ad.id} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-4 py-3">
                      {ad.thumbnailUrl
                        ? <img src={ad.thumbnailUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
                        : <div className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div>{ad.name || ad.externalId || ad.id.slice(0, 8)}</div>
                      {!byProduct && ad.productName && <div className="text-xs text-slate-500">{ad.productName}</div>}
                      <div className="flex flex-wrap items-center gap-x-3">
                        {ad.postUrl && <a href={ad.postUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-light hover:underline">відкрити пост ↗</a>}
                        {!byProduct && <AdIdCopy id={ad.externalId} />}
                      </div>
                      {!byProduct && ad.boosts?.length > 1 && (
                        <details className="mt-1 text-xs text-slate-400">
                          <summary className="cursor-pointer text-brand-light">Пост просували {ad.boosts.length} разів — показати</summary>
                          <div className="mt-1 space-y-0.5">
                            {ad.boosts.map((b) => (
                              <div key={b.id} className="flex justify-between gap-3">
                                <span className="min-w-0 truncate">
                                  <Link to={`/ad-spend/${b.id}?from=${range.from}&to=${range.to}`} className="hover:underline">{b.adCreatedAt ? new Date(b.adCreatedAt).toLocaleDateString('uk-UA') + ' · ' : ''}{b.campaignName || b.name}{b.effectiveStatus === 'ACTIVE' ? ' · активне' : ''}</Link>
                                  {' '}<AdIdCopy id={b.externalId} />
                                </span>
                                <span className="shrink-0">{m(b.spend)} · {b.contacts} розм. · {b.ordersCreated} зам.</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-3">{byProduct ? <span className="text-slate-400">{ad.activeAds} з витратами / {ad.adsCount}</span> : ad.spend > 0 ? <Badge color="green">Активне</Badge> : <Badge>Без витрат</Badge>}</td>
                    <td className="px-4 py-3 text-right">{m(ad.spend)}</td>
                    <td className="px-4 py-3 text-right">{ad.contacts ?? 0}</td>
                    <td className="px-4 py-3 text-right">{ad.ordersCreated}</td>
                    <td className="px-4 py-3 text-right">{ad.cpa !== null && ad.cpa !== undefined ? m(ad.cpa) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {ad.roi !== null && ad.roi !== undefined ? <Badge color={ad.roi >= 1 ? 'green' : 'red'}>×{ad.roi.toFixed(2)}</Badge> : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${ad.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{m(ad.profit)}</td>
                    <td className="px-4 py-3">
                      {byProduct
                        ? null
                        : <Link to={`/ad-spend/${ad.id}?from=${range.from}&to=${range.to}`} className="text-xs text-brand-light hover:underline">Детальна інформація</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
