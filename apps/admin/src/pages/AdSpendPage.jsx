// §9.13 Рекламні витрати — чистий журнал дата×сума. Прив'язка товару до оголошення
// (стала, не залежить від дати) редагується на сторінці «Оголошення», не тут.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, EmptyState, ErrorBanner, TrendChart, money } from '../components/common/Common';

// Групуємо журнал (він і так дата×оголошення, тобто кілька рядків на день) у суму витрат
// по днях для міні-графіка зверху — таблицю це не чіпає, вона лишається деталізацією.
function dailyTotals(items) {
  const byDate = new Map();
  for (const row of items) {
    const key = new Date(row.date).toISOString().slice(0, 10);
    byDate.set(key, (byDate.get(key) || 0) + Number(row.amount));
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }));
}

export default function AdSpendPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try { setItems((await api.listAdSpend()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Рекламні витрати" />
      <ErrorBanner message={error} />
      <p className="mb-4 text-xs text-slate-500">
        Прив'язка товару до оголошення — на сторінці <a href="/ads" className="text-brand-light hover:underline">«Оголошення»</a> (не тут, бо вона не змінюється щодня).
        Автоматичне підтягування — крон-Flows о 00:00.
      </p>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Витрат ще немає" hint="Дані підтягнуться автоматично, щойно запрацює синхронізація реклами." />
      ) : (
        <>
        {dailyTotals(items).length > 1 && (
          <Card className="mb-4 p-4">
            <h3 className="mb-3 text-sm font-semibold">Витрата по днях</h3>
            <TrendChart data={dailyTotals(items)} valueKey="amount" formatValue={(v) => money(v)} />
          </Card>
        )}
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
                  <td className="px-4 py-3 text-slate-400">{row.ad.product?.name || '— не привʼязано —'}</td>
                  <td className="px-4 py-3">{money(row.amount)} {row.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        </>
      )}
    </div>
  );
}
