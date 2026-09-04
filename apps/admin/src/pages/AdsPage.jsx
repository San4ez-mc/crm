// "Оголошення" — чисто технічна сторінка (2026-09-03, за проханням власника): лише
// фото/назва/кампанія + прив'язка товару. Всі показники (витрата, CTR, CPC, окупність,
// прибуток) переїхали на «Рекламні витрати» (AdSpendPage) — там і per-оголошення список,
// і детальна аналітика по кліку. Ad не залежить від дати, тому прив'язка робиться тут один раз.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Input, Select, Card, EmptyState, ErrorBanner } from '../components/common/Common';
import ImageLightbox from '../components/common/ImageLightbox';

export default function AdsPage() {
  const [items, setItems] = useState(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  async function load() {
    setError('');
    try {
      const [a, p] = await Promise.all([api.listAds(), api.listProducts()]);
      setItems(a.data); setProducts(p.data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function linkProduct(ad, productId) {
    try { await api.updateAd(ad.id, { productId }); load(); } catch (e) { alert(e.message); }
  }

  async function syncNow() {
    setSyncing(true); setSyncResult(null); setError('');
    try {
      const { data } = await api.syncAdSpendNow();
      setSyncResult(data);
      if (data.status === 'ok') load();
    } catch (e) { setError(e.message); }
    finally { setSyncing(false); }
  }

  return (
    <div>
      <PageHeader title="Оголошення" action={<Button onClick={syncNow} disabled={syncing}>{syncing ? 'Отримую…' : '🔄 Отримати дані зараз'}</Button>} />
      <ErrorBanner message={error} />
      {syncResult && (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${syncResult.status === 'ok' ? 'border-emerald-800 bg-emerald-900/20 text-emerald-300' : syncResult.status === 'pending' ? 'border-amber-800 bg-amber-900/20 text-amber-300' : 'border-red-800 bg-red-900/20 text-red-300'}`}>
          {syncResult.status === 'ok' && `Готово: ${syncResult.date}, оголошень ${syncResult.adsCount}, записано ${syncResult.written}`}
          {syncResult.status === 'pending' && 'Meta ще формує звіт (async) — спробуйте ще раз за хвилину.'}
          {syncResult.status === 'error' && `Помилка Meta Ads API: ${syncResult.error}`}
        </div>
      )}
      <p className="mb-4 text-xs text-slate-500">Прив'язка товару робиться один раз тут (оголошення не змінюється щодня). Показники витрат/окупності/прибутку — на сторінці «Рекламні витрати».</p>
      <div className="mb-4">
        <Input className="max-w-xs" placeholder="Пошук за назвою або ad_id" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Оголошень ще немає" hint="Дані підтягнуться автоматично, щойно запрацює синхронізація реклами." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3"></th><th className="px-4 py-3">Оголошення</th><th className="px-4 py-3">Кампанія</th><th className="px-4 py-3">Товар</th></tr>
            </thead>
            <tbody>
              {items.filter((ad) => {
                if (!search.trim()) return true;
                const s = search.trim().toLowerCase();
                return (ad.name || '').toLowerCase().includes(s) || (ad.externalId || '').toLowerCase().includes(s);
              }).map((ad) => (
                <tr key={ad.id} className={`border-b border-slate-800/60 last:border-0 ${!ad.productId ? 'bg-amber-900/10' : ''}`}>
                  <td className="px-4 py-3">
                    {ad.thumbnailUrl
                      ? <img src={ad.thumbnailUrl} alt="" className="h-14 w-14 cursor-zoom-in rounded-md object-cover" onClick={() => setLightbox(ad.thumbnailUrl)} />
                      : <div className="flex h-14 w-14 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>}
                  </td>
                  <td className="px-4 py-3">{ad.name || ad.externalId || ad.id.slice(0, 8)}</td>
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
