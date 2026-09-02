// "Оголошення" — прив'язка товару до оголошення живе тут (Ad не залежить від дати,
// на відміну від AdSpendPage, де раніше та сама прив'язка повторювалась на кожному
// денному рядку). Тут же — стан синхронізації і фото креативу (якщо крон його підтяг).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Select, Card, EmptyState, ErrorBanner, Badge, money } from '../components/common/Common';
import ImageLightbox from '../components/common/ImageLightbox';

export default function AdsPage() {
  const [items, setItems] = useState(null);
  const [products, setProducts] = useState([]);
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
      <p className="mb-4 text-xs text-slate-500">Прив'язка товару робиться один раз тут (оголошення не змінюється щодня, на відміну від суми витрат — та дивись на сторінці «Рекламні витрати»). Автоматичне підтягування — крон-Flows о 00:00.</p>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Оголошень ще немає" hint="Дані підтягнуться автоматично, щойно запрацює синхронізація реклами." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3"></th><th className="px-4 py-3">Оголошення</th><th className="px-4 py-3">Кампанія</th><th className="px-4 py-3">Товар</th><th className="px-4 py-3">Всього витрачено</th><th className="px-4 py-3">CTR</th><th className="px-4 py-3">CPC</th><th className="px-4 py-3">Синхр.</th></tr>
            </thead>
            <tbody>
              {items.map((ad) => (
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
                  <td className="px-4 py-3">{money(ad.totalSpend || 0)}</td>
                  <td className="px-4 py-3 text-slate-400">{ad.ctr !== null && ad.ctr !== undefined ? `${Number(ad.ctr).toFixed(1)}%` : '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{ad.cpc !== null && ad.cpc !== undefined ? money(ad.cpc) : '—'}</td>
                  <td className="px-4 py-3">{ad.lastSyncedAt ? <Badge color="green">{new Date(ad.lastSyncedAt).toLocaleDateString('uk-UA')}</Badge> : <Badge color="amber">ще ні</Badge>}</td>
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
