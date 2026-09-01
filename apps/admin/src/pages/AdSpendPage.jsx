// §9.13 Рекламні витрати — таблиця дата×оголошення×товар×сума, inline-прив'язка товару.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Select, Card, EmptyState, ErrorBanner, money } from '../components/common/Common';

export default function AdSpendPage() {
  const [items, setItems] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  async function load() {
    setError('');
    try {
      const [s, p] = await Promise.all([api.listAdSpend(), api.listProducts()]);
      setItems(s.data); setProducts(p.data);
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
      <PageHeader title="Рекламні витрати" action={<Button onClick={syncNow} disabled={syncing}>{syncing ? 'Отримую…' : '🔄 Отримати дані зараз'}</Button>} />
      <ErrorBanner message={error} />
      {syncResult && (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${syncResult.status === 'ok' ? 'border-emerald-800 bg-emerald-900/20 text-emerald-300' : syncResult.status === 'pending' ? 'border-amber-800 bg-amber-900/20 text-amber-300' : 'border-red-800 bg-red-900/20 text-red-300'}`}>
          {syncResult.status === 'ok' && `Готово: ${syncResult.date}, оголошень ${syncResult.adsCount}, записано ${syncResult.written}`}
          {syncResult.status === 'pending' && 'Meta ще формує звіт (async) — спробуйте ще раз за хвилину.'}
          {syncResult.status === 'error' && `Помилка Meta Ads API: ${syncResult.error}`}
        </div>
      )}
      <p className="mb-4 text-xs text-slate-500">Автоматичне щоденне підтягування через Meta Ads API (крон-Flows, о 00:00). Кнопка вище тригерить той самий сценарій негайно. Ручне редагування суми не передбачене — лише прив'язка товару.</p>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Витрат ще немає" hint="Дані підтягнуться автоматично, щойно запрацює Flows-автоматизація Zernio." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Оголошення</th><th className="px-4 py-3">Товар</th><th className="px-4 py-3">Сума</th></tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className={`border-b border-slate-800/60 last:border-0 ${!row.ad.productId ? 'bg-amber-900/10' : ''}`}>
                  <td className="px-4 py-3 text-slate-400">{new Date(row.date).toLocaleDateString('uk-UA')}</td>
                  <td className="px-4 py-3">{row.ad.name || row.ad.externalId || row.ad.id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <Select className="!w-auto py-1" value={row.ad.productId || ''} onChange={(e) => linkProduct(row.ad, e.target.value)}>
                      <option value="">— прив'язати до товару —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-3">{money(row.amount)} {row.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
