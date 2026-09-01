// §9.4 Категорії — список + форма (drawer/модалка).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Field, Input, Textarea, Card, EmptyState, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';

export default function CategoriesPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null=закрито, {}=нова, {...}=редагування

  async function load() {
    setError('');
    try { setItems((await api.listCategories()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleSave(form) {
    try {
      if (form.id) await api.updateCategory(form.id, form);
      else await api.createCategory(form);
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити категорію?')) return;
    try { await api.deleteCategory(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Категорії" action={<Button onClick={() => setEditing({})}>+ Категорія</Button>} />
      <ErrorBanner message={error} />
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Категорій ще немає" action={<Button onClick={() => setEditing({})}>+ Категорія</Button>} />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Назва</th><th className="px-4 py-3">Товарів</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-slate-400">{c.productsCount}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <IconButton onClick={() => setEditing(c)}>✏️</IconButton>
                      <IconButton onClick={() => handleDelete(c.id)}>🗑️</IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal isOpen={!!editing} title={editing?.id ? 'Редагувати категорію' : 'Нова категорія'} onClose={() => setEditing(null)}>
        {editing && <CategoryForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function CategoryForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id, name: initial.name || '', description: initial.description || '', aiInstructions: initial.aiInstructions || '',
    requiredParams: initial.requiredParams || [],
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Назва"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Опис"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Параметри, які треба запитати перед оформленням">
        <RequiredParamsEditor value={form.requiredParams} onChange={(v) => setForm({ ...form, requiredParams: v })} />
      </Field>
      <Field label="Інформація для ШІ (вільний текст, додатково до параметрів вище)">
        <Textarea rows={3} placeholder="Напр. нюанси розмірної сітки, застереження для бота" value={form.aiInstructions} onChange={(e) => setForm({ ...form, aiInstructions: e.target.value })} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}

function RequiredParamsEditor({ value = [], onChange }) {
  function update(i, field, v) {
    onChange(value.map((row, idx) => (idx === i ? { ...row, [field]: v } : row)));
  }
  function remove(i) { onChange(value.filter((_, idx) => idx !== i)); }
  function add() { onChange([...value, { name: '', unit: '', hint: '' }]); }
  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,70px)_minmax(0,1fr)_auto] items-center gap-2">
          <Input placeholder="напр. зріст" value={row.name || ''} onChange={(e) => update(i, 'name', e.target.value)} />
          <Input placeholder="см" value={row.unit || ''} onChange={(e) => update(i, 'unit', e.target.value)} />
          <Input placeholder="підказка боту (необовʼязково)" value={row.hint || ''} onChange={(e) => update(i, 'hint', e.target.value)} />
          <IconButton onClick={() => remove(i)}>🗑️</IconButton>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={add}>+ Параметр</Button>
    </div>
  );
}
