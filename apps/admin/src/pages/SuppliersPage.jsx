// §9.5 Постачальники — список + форма. 2026-09-05 (за проханням власника): прибрано спільний
// tenant-рівня блок "Ключі автоматизації замовлень" (плутав, які ключі якого постачальника) —
// усе тепер per-supplier у вікні редагування, згруповано по блоках: Сайт/Telegram/API/Рецепт.
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Field, Label, Input, Textarea, Select, Card, EmptyState, ErrorBanner } from '../components/common/Common';
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

      <Modal isOpen={!!editing} title={editing?.id ? 'Редагувати постачальника' : 'Новий постачальник'} onClose={() => setEditing(null)} wide>
        {editing && <SupplierForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

// Довільні пари назва→значення для блоку API — постачальники мають різні набори полів
// (BrewDrop: token+sender_id; інший — просто api_key тощо), тому без фіксованої схеми.
function ApiConfigEditor({ value, onChange }) {
  const rows = Object.entries(value || {});
  function setRow(i, key, val) {
    const next = [...rows];
    next[i] = [key, val];
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())));
  }
  function addRow() { onChange({ ...(value || {}), '': '' }); }
  function removeRow(i) { onChange(Object.fromEntries(rows.filter((_, idx) => idx !== i))); }
  return (
    <div className="space-y-1.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <Input className="w-40 !py-1 text-xs" placeholder="Назва (напр. token)" value={k} onChange={(e) => setRow(i, e.target.value, v)} />
          <Input className="!py-1 text-xs font-mono" placeholder="Значення" value={v} onChange={(e) => setRow(i, k, e.target.value)} />
          <button type="button" onClick={() => removeRow(i)} className="px-1 text-slate-500 hover:text-red-400">✕</button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="text-xs text-brand-light hover:underline">+ Додати поле API</button>
    </div>
  );
}

// Постачальники часто мають "назву" = домен сайту (напр. "brewdrop.in.ua") — не змушуємо
// вписувати те саме двічі в поле "Сайт" (2026-09-05, за проханням власника).
function looksLikeDomain(s) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(s || '').trim());
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
    telegramName: initial.telegramName || '',
    telegramLink: initial.telegramLink || '',
    loginUsername: initial.loginUsername || '',
    loginPassword: initial.loginPassword || '',
    apiConfig: initial.apiConfig || {},
    orderRecipe: initial.orderRecipe || '',
  });

  function onNameBlur() {
    if (!form.website.trim() && looksLikeDomain(form.name)) {
      setForm((f) => ({ ...f, website: `https://${f.name.trim()}` }));
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-5">
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Основне</h4>
        <Field label="Назва"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={onNameBlur} /></Field>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Контактна інформація"><Input value={form.contactInfo} onChange={(e) => setForm({ ...form, contactInfo: e.target.value })} /></Field>
          <Field label="Механізм оформлення (технічне — визначає, яку логіку воронки викликати)">
            <Select value={form.mechanism} onChange={(e) => setForm({ ...form, mechanism: e.target.value })}>
              {MECHANISMS.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Опис"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      </section>

      <section className="border-t border-slate-800 pt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Сайт та вхід</h4>
        <Field label="Сайт"><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Логін на сайт"><Input value={form.loginUsername} onChange={(e) => setForm({ ...form, loginUsername: e.target.value })} /></Field>
          <Field label="Пароль на сайт"><Input value={form.loginPassword} onChange={(e) => setForm({ ...form, loginPassword: e.target.value })} /></Field>
        </div>
      </section>

      <section className="border-t border-slate-800 pt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Telegram</h4>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Назва групи/чату"><Input value={form.telegramName} onChange={(e) => setForm({ ...form, telegramName: e.target.value })} placeholder="напр. Постачальник — Одяг" /></Field>
          <Field label="Телеграм-група (id)"><Input value={form.telegramGroupId} onChange={(e) => setForm({ ...form, telegramGroupId: e.target.value })} /></Field>
        </div>
        <Field label="Посилання-запрошення"><Input value={form.telegramLink} onChange={(e) => setForm({ ...form, telegramLink: e.target.value })} placeholder="https://t.me/…" /></Field>
      </section>

      <section className="border-t border-slate-800 pt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">API (якщо в постачальника є)</h4>
        <p className="mb-2 text-xs text-slate-500">Довільні поля — токен, sender_id, account_id тощо, залежно від постачальника.</p>
        <ApiConfigEditor value={form.apiConfig} onChange={(v) => setForm({ ...form, apiConfig: v })} />
      </section>

      <section className="border-t border-slate-800 pt-4">
        <Label>Рецепт оформлення замовлення (для ШІ — заповнюється технічною командою/агентом, не для ручного редагування тут)</Label>
        <Textarea
          rows={6}
          readOnly
          value={form.orderRecipe}
          className="cursor-not-allowed bg-slate-800/30 font-mono text-xs"
          placeholder="Порожньо — покрокового рецепту ще немає для цього постачальника."
        />
      </section>

      <Field label="Нотатки для ШІ"><Textarea rows={2} value={form.aiNotes} onChange={(e) => setForm({ ...form, aiNotes: e.target.value })} /></Field>

      <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
