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
  const [form, setForm] = useState({ id: initial.id, name: initial.name || '', description: initial.description || '', aiInstructions: initial.aiInstructions || '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Назва"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Опис"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Інформація для ШІ">
        <Textarea rows={3} placeholder="Що бот має дізнатись у клієнта для товарів цієї категорії (напр. зріст і вага для одягу)" value={form.aiInstructions} onChange={(e) => setForm({ ...form, aiInstructions: e.target.value })} />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
