// §9.14 Журнал платежів — лише відображення (звірка йде на боці воронки, Monobank/ibanoplata).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, EmptyState, ErrorBanner, Badge, money } from '../components/common/Common';

const STATUS_COLOR = { success: 'green', pending: 'amber', failed: 'red' };

export default function PaymentsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listPayments().then((r) => setItems(r.data)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader title="Журнал платежів" />
      <ErrorBanner message={error} />
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Платежів ще немає" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Замовлення</th><th className="px-4 py-3">Сума</th><th className="px-4 py-3">Метод</th><th className="px-4 py-3">Статус</th></tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-4 py-3 text-slate-400">{new Date(p.createdAt).toLocaleString('uk-UA')}</td>
                  <td className="px-4 py-3">#{p.orderId.slice(0, 8)} · {p.order?.buyer?.fullName || p.order?.buyer?.phone || '—'}</td>
                  <td className="px-4 py-3">{money(p.amount)}</td>
                  <td className="px-4 py-3 text-slate-400">{p.method || '—'}</td>
                  <td className="px-4 py-3"><Badge color={STATUS_COLOR[p.status] || 'slate'}>{p.status || '—'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
