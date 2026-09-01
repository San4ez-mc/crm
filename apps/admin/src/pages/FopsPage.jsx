// ФОП — юрособи для прийому оплат, per-tenant (кожен магазин веде свій список).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Field, Input, Card, EmptyState, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';

export default function FopsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  async function load() {
    setError('');
    try { setItems((await api.listFops()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleSave(form) {
    try {
      if (form.id) await api.updateFop(form.id, form);
      else await api.createFop(form);
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити ФОП?')) return;
    try { await api.deleteFop(id); load(); } catch (e) { alert(e.message); }
  }

  async function handleActivate(id) {
    try { await api.activateFop(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="ФОПи" action={<Button onClick={() => setEditing({})}>+ ФОП</Button>} />
      <ErrorBanner message={error} />
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="ФОПів ще немає" action={<Button onClick={() => setEditing({})}>+ ФОП</Button>} />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Активний</th><th className="px-4 py-3">Назва</th><th className="px-4 py-3">IBAN</th><th className="px-4 py-3">ІПН</th><th className="px-4 py-3">Monobank токен</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id} className={`border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30 ${f.isActive ? 'bg-brand/5' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="radio" name="active-fop" checked={!!f.isActive} onChange={() => handleActivate(f.id)} title="Зробити активним" />
                  </td>
                  <td className="px-4 py-3">{f.name} {f.isActive && <span className="ml-1 rounded bg-brand/20 px-1.5 py-0.5 text-[10px] text-brand-light">активний</span>}</td>
                  <td className="px-4 py-3 text-slate-400">{f.iban || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{f.taxId || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{f.monobankToken ? '✓ задано' : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <IconButton onClick={() => setEditing(f)}>✏️</IconButton>
                      <IconButton onClick={() => handleDelete(f.id)}>🗑️</IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal isOpen={!!editing} title={editing?.id ? 'Редагувати ФОП' : 'Новий ФОП'} onClose={() => setEditing(null)}>
        {editing && <FopForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function FopForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id,
    name: initial.name || '',
    iban: initial.iban || '',
    taxId: initial.taxId || '',
    monobankToken: initial.monobankToken || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Назва / ПІБ ФОП"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="IBAN"><Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="UA…" /></Field>
      <Field label="ІПН"><Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></Field>
      <Field label="Токен Monobank API"><Input value={form.monobankToken} onChange={(e) => setForm({ ...form, monobankToken: e.target.value })} placeholder="для звірки надходжень" /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
