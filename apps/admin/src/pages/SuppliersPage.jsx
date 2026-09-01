// §9.5 Постачальники — список + форма + ключі автоматизації замовлень (BrewDrop/EasyDrop).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Field, Input, Textarea, Select, Card, EmptyState, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';

const MECHANISMS = ['ручне', 'EasyDrop', 'BrewDrop', 'інше'];

// Ключі автоматизованого оформлення замовлень постачальнику — використовуються воронкою
// (BrewDrop API, EasyDrop офлайн-форма/кошик). Перенесено сюди зі сторінки Автоматизації —
// логічно ближче до самих постачальників, ніж до загального каталогу сервісів.
const SUPPLIER_KEYS = [
  { key: 'BREWDROP_TOKEN', label: 'BrewDrop — токен', isSecret: true },
  { key: 'BREWDROP_SENDER_ID', label: 'BrewDrop — sender_id', isSecret: false },
  { key: 'EASYDROP_LOGIN', label: 'EasyDrop — логін', isSecret: false },
  { key: 'EASYDROP_PASS', label: 'EasyDrop — пароль', isSecret: true },
  { key: 'EASYDROP_SUPPLIER_ID', label: 'EasyDrop — id постачальника', isSecret: false },
];

function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${'•'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

export default function SuppliersPage() {
  const [items, setItems] = useState(null);
  const [secrets, setSecrets] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [editingSecret, setEditingSecret] = useState(null);

  async function load() {
    setError('');
    try {
      const [s, sec] = await Promise.all([api.listSuppliers(), api.listSecrets()]);
      setItems(s.data); setSecrets(sec.data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  const secretByKey = Object.fromEntries((secrets || []).map((s) => [s.key, s]));
  async function openSecret(known) {
    const existing = secretByKey[known.key];
    if (!existing) { setEditingSecret({ key: known.key, label: known.label, value: '', isSecret: known.isSecret }); return; }
    try { setEditingSecret((await api.getSecret(existing.id)).data); } catch (e) { setError(e.message); }
  }
  async function saveSecret(form) {
    try {
      if (form.id) await api.updateSecret(form.id, form);
      else await api.createSecret(form);
      setEditingSecret(null);
      load();
    } catch (e) { setError(e.message); }
  }
  async function deleteSecret(id) {
    if (!confirm('Видалити значення ключа?')) return;
    try { await api.deleteSecret(id); load(); } catch (e) { alert(e.message); }
  }

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

      <Card className="mb-5 p-5">
        <h3 className="mb-1 text-sm font-semibold">Ключі автоматизації замовлень</h3>
        <p className="mb-3 text-xs text-slate-500">Використовує воронка для автоматичного оформлення замовлення постачальнику (BrewDrop API, EasyDrop форма/кошик).</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SUPPLIER_KEYS.map((k) => {
            const existing = secretByKey[k.key];
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => openSecret(k)}
                className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-left text-sm hover:border-brand"
              >
                <div className="min-w-0">
                  <div className="truncate">{k.label}</div>
                  <div className="truncate font-mono text-xs text-slate-500">{existing ? (k.isSecret ? mask(existing.value) : existing.value) : '— не задано —'}</div>
                </div>
                {existing
                  ? <IconButton onClick={(e) => { e.stopPropagation(); deleteSecret(existing.id); }}>🗑️</IconButton>
                  : <span className="shrink-0 text-xs text-slate-600">+</span>}
              </button>
            );
          })}
        </div>
      </Card>

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
      <Modal isOpen={!!editingSecret} title={editingSecret?.id ? 'Редагувати ключ' : 'Задати ключ'} onClose={() => setEditingSecret(null)}>
        {editingSecret && <SecretForm initial={editingSecret} onSave={saveSecret} onCancel={() => setEditingSecret(null)} />}
      </Modal>
    </div>
  );
}

function SecretForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id, key: initial.key, label: initial.label || '', value: initial.value || '',
    isSecret: initial.isSecret !== undefined ? initial.isSecret : true,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Ключ"><Input disabled value={form.key} className="font-mono text-xs" /></Field>
      <Field label="Значення"><Input required autoFocus value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}

export function SupplierForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id,
    name: initial.name || '',
    mechanism: initial.mechanism || MECHANISMS[0],
    contactInfo: initial.contactInfo || '',
    description: initial.description || '',
    aiNotes: initial.aiNotes || '',
    website: initial.website || '',
    telegramGroupId: initial.telegramGroupId || '',
    loginUsername: initial.loginUsername || '',
    loginPassword: initial.loginPassword || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Назва"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Механізм оформлення">
        <Select value={form.mechanism} onChange={(e) => setForm({ ...form, mechanism: e.target.value })}>
          {MECHANISMS.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
      </Field>
      <Field label="Контактна інформація"><Input value={form.contactInfo} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} /></Field>
      <Field label="Сайт"><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" /></Field>
      <Field label="Телеграм-група (id)"><Input value={form.telegramGroupId} onChange={(e) => setForm({ ...form, telegramGroupId: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Логін на сайт"><Input value={form.loginUsername} onChange={(e) => setForm({ ...form, loginUsername: e.target.value })} /></Field>
        <Field label="Пароль на сайт"><Input value={form.loginPassword} onChange={(e) => setForm({ ...form, loginPassword: e.target.value })} /></Field>
      </div>
      <Field label="Опис"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Нотатки для ШІ"><Textarea rows={2} value={form.aiNotes} onChange={(e) => setForm({ ...form, aiNotes: e.target.value })} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
