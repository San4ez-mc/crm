// ДОПОВНЕННЯ 2026-08-31 — Ключі API (Meta/FB, Monobank тощо) в одному місці per-tenant.
// Значення в списку замасковані; повне значення підвантажується лише при відкритті форми.
// "Синхронізовано в воронку" — заповнюється, коли Flows-нода тягне GET /secrets/export.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Field, Input, Card, EmptyState, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';

const SUGGESTED_KEYS = [
  { key: 'META_SYSTEM_USER_TOKEN', label: 'Meta System User Token' },
  { key: 'META_AD_ACCOUNT_ID', label: 'Meta Ad Account ID' },
  { key: 'FB_PIXEL_ID', label: 'Facebook Pixel ID' },
  { key: 'FB_CAPI_TOKEN', label: 'Facebook Conversions API Token' },
];

export default function SettingsKeysPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // {id?, key, label, value, isSecret}

  async function load() {
    setError('');
    try { setItems((await api.listSecrets()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function openEdit(row) {
    if (!row.id) { setEditing(row); return; }
    try { setEditing((await api.getSecret(row.id)).data); } catch (e) { setError(e.message); }
  }

  async function handleSave(form) {
    try {
      if (form.id) await api.updateSecret(form.id, form);
      else await api.createSecret(form);
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити ключ?')) return;
    try { await api.deleteSecret(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Ключі API" action={<Button onClick={() => openEdit({ key: '', label: '', value: '', isSecret: true })}>+ Ключ</Button>} />
      <ErrorBanner message={error} />
      <p className="mb-4 max-w-2xl text-sm text-slate-400">
        Ключі зберігаються тут per-магазин і звідси підхоплюються воронкою Flows автоматично
        (нода воронки читає їх через захищений ендпойнт СРМ) — заповнювати їх ще і в самій
        воронці більше не потрібно.
      </p>

      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Ключів ще немає" action={<Button onClick={() => openEdit({ key: '', label: '', value: '', isSecret: true })}>+ Ключ</Button>} />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Ключ</th><th className="px-4 py-3">Назва</th><th className="px-4 py-3">Значення</th><th className="px-4 py-3">Синхронізовано</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30" onClick={() => openEdit(s)}>
                  <td className="px-4 py-3 font-mono text-xs">{s.key}</td>
                  <td className="px-4 py-3 text-slate-400">{s.label || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{s.value}</td>
                  <td className="px-4 py-3 text-slate-500">{s.syncedToFunnelAt ? new Date(s.syncedToFunnelAt).toLocaleString('uk-UA') : '— ще не синхронізовано'}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <IconButton onClick={() => openEdit(s)}>✏️</IconButton>
                      <IconButton onClick={() => handleDelete(s.id)}>🗑️</IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal isOpen={!!editing} title={editing?.id ? 'Редагувати ключ' : 'Новий ключ'} onClose={() => setEditing(null)}>
        {editing && <SecretForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function SecretForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id,
    key: initial.key || '',
    label: initial.label || '',
    value: initial.value || '',
    isSecret: initial.isSecret !== undefined ? initial.isSecret : true,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Ключ (код)">
        <Input required disabled={!!initial.id} list="suggested-keys" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.trim() })} placeholder="напр. META_SYSTEM_USER_TOKEN" />
        <datalist id="suggested-keys">
          {SUGGESTED_KEYS.map((s) => <option key={s.key} value={s.key} />)}
        </datalist>
      </Field>
      <Field label="Людська назва"><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
      <Field label="Значення"><Input required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
