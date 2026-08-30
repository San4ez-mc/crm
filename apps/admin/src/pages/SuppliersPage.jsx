// §9.5 Постачальники — список + форма.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Field, Input, Select, Card, EmptyState, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';

const MECHANISMS = ['ручне', 'EasyDrop', 'BrewDrop', 'інше'];

export default function SuppliersPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  async function load() {
    setError('');
    try { setItems((await api.listSuppliers()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleSave(form) {
    try {
      if (form.id) await api.updateSupplier(form.id, form);
      else await api.createSupplier(form);
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити постачальника?')) return;
    try { await api.deleteSupplier(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Постачальники" action={<Button onClick={() => setEditing({})}>+ Постачальник</Button>} />
      <ErrorBanner message={error} />
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Постачальників ще немає" action={<Button onClick={() => setEditing({})}>+ Постачальник</Button>} />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Назва</th><th className="px-4 py-3">Механізм</th><th className="px-4 py-3">Товарів</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3 text-slate-400">{s.mechanism || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{s.productsCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <IconButton onClick={() => setEditing(s)}>✏️</IconButton>
                      <IconButton onClick={() => handleDelete(s.id)}>🗑️</IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal isOpen={!!editing} title={editing?.id ? 'Редагувати постачальника' : 'Новий постачальник'} onClose={() => setEditing(null)}>
        {editing && <SupplierForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

export function SupplierForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ id: initial.id, name: initial.name || '', mechanism: initial.mechanism || MECHANISMS[0], contactInfo: initial.contactInfo || '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Назва"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Механізм оформлення">
        <Select value={form.mechanism} onChange={(e) => setForm({ ...form, mechanism: e.target.value })}>
          {MECHANISMS.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </Field>
      <Field label="Контактна інформація"><Input value={form.contactInfo} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
