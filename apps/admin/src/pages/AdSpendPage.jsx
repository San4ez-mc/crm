// §9.13 Рекламні витрати — таблиця дата×оголошення×товар×сума, inline-прив'язка товару.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Select, Card, EmptyState, ErrorBanner, money } from '../components/common/Common';

export default function AdSpendPage() {
  const [items, setItems] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');

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

  return (
    <div>
      <PageHeader title="Рекламні витрати" />
      <ErrorBanner message={error} />
      <p className="mb-4 text-xs text-slate-500">Автоматичне щоденне підтягування через Zernio-конектор (крон-Flows). Ручне редагування суми не передбачене — лише прив'язка товару.</p>
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
