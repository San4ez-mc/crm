// "Оголошення" — чисто технічна сторінка (2026-09-03, за проханням власника): лише
// фото/назва/кампанія + прив'язка товару. Всі показники (витрата, CTR, CPC, окупність,
// прибуток) переїхали на «Рекламні витрати» (AdSpendPage) — там і per-оголошення список,
// і детальна аналітика по кліку. Ad не залежить від дати, тому прив'язка робиться тут один раз.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Input, Select, Card, EmptyState, ErrorBanner, formatDate } from '../components/common/Common';
import ImageLightbox from '../components/common/ImageLightbox';

export default function AdsPage() {
  const [items, setItems] = useState(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  // 2026-09-13 (живий баг, Олексій: "я не знаю, звідки підтягнуло ці рекламні оголошення" —
  // Meta-токен бачить КІЛЬКА рекламних кабінетів одночасно). Мультивибір: порожній Set = "усі".
  const [accounts, setAccounts] = useState([]);
  const [selectedAccounts, setSelectedAccounts] = useState(new Set());
  const [acctMenuOpen, setAcctMenuOpen] = useState(false);

  async function load(acctFilter) {
    setError('');
    try {
      const acctIds = (acctFilter !== undefined ? acctFilter : selectedAccounts);
      const params = { take: '3000' }; // 2026-09-13: дефолт 100 ховав більшість із 1500+ оголошень після повного синку
      if (acctIds.size > 0) params.adAccountId = [...acctIds].join(',');
      const [a, p, acc] = await Promise.all([api.listAds(params), api.listProducts(), api.listAdAccounts()]);
      setItems(a.data); setProducts(p.data); setAccounts(acc.data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function toggleAccount(id) {
    const next = new Set(selectedAccounts);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedAccounts(next);
    load(next);
  }

  async function linkProduct(ad, productId) {
    try { await api.updateAd(ad.id, { productId }); load(); } catch (e) { alert(e.message); }
  }

  async function syncNow() {
    setSyncing(true); setSyncResult(null); setError('');
    try {
      // 2026-09-13 (власник: "це я хочу вибирати на сторінці" — не хардкодити кабінет): якщо
      // обрано конкретний(і) кабінет(и) у фільтрі — синкаємо ЛИШЕ їх; порожній вибір = "усі"
      // (бекенд сам вирішує — funnelKey override або auto-discovery, як налаштовано на боті).
      const { data } = await api.syncAdSpendNow(selectedAccounts.size > 0 ? [...selectedAccounts] : undefined);
      setSyncResult(data);
      if (data.status === 'ok') load();
    } catch (e) { setError(e.message); }
    finally { setSyncing(false); }
  }

  return (
    <div>
      <PageHeader title="Оголошення" action={
        <Button onClick={syncNow} disabled={syncing} title={selectedAccounts.size > 0 ? 'Синхронізує лише обрані в фільтрі кабінети' : 'Синхронізує всі кабінети (за налаштуванням боту)'}>
          {syncing ? 'Отримую…' : `🔄 Отримати дані зараз${selectedAccounts.size > 0 ? ` (${selectedAccounts.size})` : ''}`}
        </Button>
      } />
      <ErrorBanner message={error} />
      {syncResult && (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${syncResult.status === 'ok' ? 'border-emerald-800 bg-emerald-900/20 text-emerald-300' : syncResult.status === 'pending' ? 'border-amber-800 bg-amber-900/20 text-amber-300' : 'border-red-800 bg-red-900/20 text-red-300'}`}>
          {syncResult.status === 'ok' && `Готово: ${syncResult.date}, оголошень ${syncResult.adsCount}, записано ${syncResult.written}`}
          {syncResult.status === 'pending' && 'Meta ще формує звіт (async) — спробуйте ще раз за хвилину.'}
          {syncResult.status === 'error' && `Помилка Meta Ads API: ${syncResult.error}`}
        </div>
      )}
      <p className="mb-4 text-xs text-slate-500">Прив'язка товару робиться один раз тут (оголошення не змінюється щодня). Показники витрат/окупності/прибутку — на сторінці «Рекламні витрати».</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Пошук за назвою або ad_id" value={search} onChange={(e) => setSearch(e.target.value)} />
        {accounts.length > 1 && (
          <div className="relative">
            <Button variant="secondary" className="!py-1.5 text-xs" onClick={() => setAcctMenuOpen((v) => !v)}>
              📁 Кабінет: {selectedAccounts.size === 0 ? 'усі' : `${selectedAccounts.size} обрано`} ▾
            </Button>
            {acctMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setAcctMenuOpen(false)} />
                <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl">
                  {selectedAccounts.size > 0 && (
                    <button className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-brand-light hover:bg-slate-800" onClick={() => { setSelectedAccounts(new Set()); load(new Set()); }}>
                      ✕ Скинути (показати всі)
                    </button>
                  )}
                  {accounts.map((a) => (
                    <label key={a.adAccountId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-800">
                      <input type="checkbox" checked={selectedAccounts.has(a.adAccountId)} onChange={() => toggleAccount(a.adAccountId)} />
                      <span className="flex-1 truncate">{a.adAccountName || a.adAccountId}</span>
                      <span className="text-xs text-slate-500">{a.count}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Оголошень ще немає" hint="Дані підтягнуться автоматично, щойно запрацює синхронізація реклами." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3"></th><th className="px-4 py-3">Оголошення</th><th className="px-4 py-3">Кампанія</th><th className="px-4 py-3">Товар</th></tr>
            </thead>
            <tbody>
              {items.filter((ad) => {
                if (!search.trim()) return true;
                const s = search.trim().toLowerCase();
                return (ad.name || '').toLowerCase().includes(s) || (ad.externalId || '').toLowerCase().includes(s);
              }).map((ad) => (
                <tr key={ad.id} className={`border-b border-slate-800/60 last:border-0 ${!ad.productId ? 'bg-amber-900/10' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-400">{formatDate(ad.createdAt)}</td>
                  <td className="px-4 py-3">
                    {/* 2026-09-11: 112px (повне x2) розмазував дрібні джерела (Meta/KeyCRM thumbnails
                        зазвичай ~60-100px) — це не рендер, а фізична межа роздільності вихідного файлу.
                        80px — компроміс: помітно більше за оригінальні 56px, але менше апскейлу. */}
                    {ad.thumbnailUrl
                      ? <img src={ad.thumbnailUrl} alt="" className="h-20 w-20 cursor-zoom-in rounded-md object-cover" onClick={() => setLightbox(ad.thumbnailUrl)} />
                      : <div className="flex h-20 w-20 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div>{ad.name || ad.externalId || ad.id.slice(0, 8)}</div>
                    {/* 2026-09-13 (власник: ID на сторінці не співпадали з тими, що видно в Meta Ads
                        Manager — незрозуміло, який саме рівень показуємо). Meta має 3 РІЗНІ ID:
                        Campaign / Ad Set / Ad — показуємо всі три явно підписаними, моно-шрифтом,
                        щоб можна було звірити з колонками в Ads Manager напряму. */}
                    {(ad.campaignId || ad.adSetId || ad.externalId) && (
                      <div className="mt-0.5 space-y-0.5 font-mono text-[11px] text-slate-500">
                        {ad.campaignId && <div>Campaign ID: {ad.campaignId}</div>}
                        {ad.adSetId && <div>Ad Set ID: {ad.adSetId}</div>}
                        {ad.externalId && <div>Ad ID: {ad.externalId}</div>}
                      </div>
                    )}
                    {(ad.thumbnailUrl || (ad.adAccountId && ad.externalId)) && (
                      <div className="mt-0.5 flex flex-wrap gap-2 text-xs">
                        {ad.thumbnailUrl && (
                          <a href={ad.thumbnailUrl} target="_blank" rel="noreferrer" className="text-brand-light hover:underline">🖼️ Фото</a>
                        )}
                        {ad.adAccountId && ad.externalId && (
                          <a
                            href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(ad.adAccountId)}&selected_ad_ids=${encodeURIComponent(ad.externalId)}`}
                            target="_blank" rel="noreferrer" className="text-brand-light hover:underline"
                          >
                            🔗 Ads Manager
                          </a>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{ad.campaignName || '—'}</td>
                  <td className="px-4 py-3">
                    <Select className="!w-auto py-1" value={ad.productId || ''} onChange={(e) => linkProduct(ad, e.target.value)}>
                      <option value="">— прив'язати до товару —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <ImageLightbox url={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
