// §9.15 Витрати по товару — inline-редагування (autosave), маржа в грошах і %.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, EmptyState, ErrorBanner, money } from '../components/common/Common';

export default function ProductExpensesPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);

  async function load() {
    setError('');
    try { setItems((await api.listProductExpenses()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function saveField(row, field, value) {
    setSaving(row.productId);
    try {
      await api.updateProductExpense(row.productId, { [field]: Number(value) || 0 });
      load();
    } catch (e) { alert(e.message); } finally { setSaving(null); }
  }

  return (
    <div>
      <PageHeader title="Витрати по товару" />
      <ErrorBanner message={error} />
      <p className="mb-4 text-xs text-slate-500">Автозбереження при виході з поля. Від'ємна маржа за добу автоматично сигналізується Flows-автоматизацією (не самою CRM).</p>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Товарів ще немає" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Товар</th><th className="px-4 py-3">Собівартість</th><th className="px-4 py-3">Менеджер (фікс)</th>
                <th className="px-4 py-3">Менеджер (%)</th><th className="px-4 py-3">Реклама</th><th className="px-4 py-3">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.productId} className={`border-b border-slate-800/60 last:border-0 ${saving === row.productId ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">{row.name}<div className="text-xs text-slate-500">{row.sku}</div></td>
                  <td className="px-4 py-3"><EditableNumber value={row.cogs} onCommit={(v) => saveField(row, 'cogs', v)} /></td>
                  <td className="px-4 py-3"><EditableNumber value={row.managerCostFixed} onCommit={(v) => saveField(row, 'managerCostFixed', v)} /></td>
                  <td className="px-4 py-3"><EditableNumber value={row.managerCostPercent} suffix="%" onCommit={(v) => saveField(row, 'managerCostPercent', v)} /></td>
                  <td className="px-4 py-3 text-slate-400">{money(row.adSpend)}</td>
                  <td className={`px-4 py-3 ${row.margin < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{money(row.margin)} ({row.marginPercent?.toFixed(0) ?? '—'}%)</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function EditableNumber({ value, onCommit, suffix = '' }) {
  return (
    <input
      type="number"
      step="0.01"
      defaultValue={value}
      onBlur={(e) => onCommit(e.target.value)}
      className="w-24 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm focus:border-brand focus:outline-none"
    />
  );
}
