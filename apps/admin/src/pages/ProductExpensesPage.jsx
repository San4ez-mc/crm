// §9.15 Витрати по товару — inline-редагування (autosave), маржа в грошах і %.
// 2026-09-07 (фідбек власника): "Собівартість" тепер відкриває блок історії цін постачальника
// — [{ціна, діє з дати}] — бо постачальники міняють ціну, і маржа по кожному замовленню має
// рахуватись за ціною, що діяла НА ДАТУ того замовлення (lib/margin.js cogsAt), а не поточною.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, EmptyState, ErrorBanner, Button, IconButton, Input, money, kyivDateStr } from '../components/common/Common';
import Modal from '../components/common/Modal';

export default function ProductExpensesPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(null);
  const [historyRow, setHistoryRow] = useState(null);

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
                <th className="px-4 py-3">Товар</th><th className="px-4 py-3">Ціна постачальника</th><th className="px-4 py-3">Менеджер (фікс)</th>
                <th className="px-4 py-3">Менеджер (%)</th><th className="px-4 py-3">Реклама</th><th className="px-4 py-3">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.productId} className={`border-b border-slate-800/60 last:border-0 ${saving === row.productId ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">{row.name}<div className="text-xs text-slate-500">{row.sku}</div></td>
                  <td className="px-4 py-3">
                    <button type="button" className="text-left hover:underline" onClick={() => setHistoryRow(row)}>
                      {money(row.cogs)}
                      <div className="text-[11px] text-slate-500">{row.cogsHistory?.length > 1 ? `${row.cogsHistory.length} цін в історії` : 'редагувати →'}</div>
                    </button>
                  </td>
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
      {historyRow && <CostHistoryModal row={historyRow} onClose={() => setHistoryRow(null)} onSaved={load} />}
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

function todayStr() { return kyivDateStr(); }

function CostHistoryModal({ row, onClose, onSaved }) {
  const [history, setHistory] = useState(
    row.cogsHistory?.length ? row.cogsHistory : (row.cogs ? [{ cost: row.cogs, validFrom: todayStr() }] : []),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function update(i, field, v) { setHistory(history.map((h, idx) => (idx === i ? { ...h, [field]: v } : h))); }
  function remove(i) { setHistory(history.filter((_, idx) => idx !== i)); }
  function add() { setHistory([...history, { cost: '', validFrom: todayStr() }]); }

  async function save() {
    setError(''); setSaving(true);
    try {
      await api.updateProductExpense(row.productId, {
        cogsHistory: history.map((h) => ({ cost: Number(h.cost) || 0, validFrom: h.validFrom })),
      });
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  const sorted = [...history].sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)));

  return (
    <Modal isOpen title={`Ціна постачальника: ${row.name}`} onClose={onClose}>
      <ErrorBanner message={error} />
      <p className="mb-3 text-xs text-slate-500">
        Постачальники міняють ціну — додайте новий рядок із датою, з якої вона діє. Маржа по
        кожному замовленню рахується за ціною, що діяла НА ДАТУ того замовлення, а не поточною —
        зміна ціни заднім числом не зіпсує вже пораховану історичну маржу.
      </p>
      <div className="space-y-2">
        {sorted.map((h) => {
          const i = history.indexOf(h);
          return (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
              <Input type="number" step="0.01" min="0" placeholder="ціна постачальника" value={h.cost} onChange={(e) => update(i, 'cost', e.target.value)} />
              <Input type="date" value={h.validFrom} onChange={(e) => update(i, 'validFrom', e.target.value)} />
              <IconButton onClick={() => remove(i)}>🗑️</IconButton>
            </div>
          );
        })}
        {sorted.length === 0 && <p className="text-xs text-slate-500">Ціни ще немає — додайте перший рядок.</p>}
      </div>
      <Button type="button" variant="secondary" className="mt-2" onClick={add}>+ Нова ціна з дати</Button>
      <div className="mt-4 flex justify-end gap-2 border-t border-slate-800 pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>Скасувати</Button>
        <Button type="button" onClick={save} disabled={saving}>{saving ? 'Зберігаю…' : 'Зберегти'}</Button>
      </div>
    </Modal>
  );
}
