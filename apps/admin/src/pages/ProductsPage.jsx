// §9.2 Товари — список.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Input, Select, Card, EmptyState, ErrorBanner, money } from '../components/common/Common';
import ProductFormModal from './ProductFormModal';

export default function ProductsPage() {
  const [items, setItems] = useState(null);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null закрито, {} новий, {...} редагування

  async function load() {
    setError('');
    try {
      const params = { isSet: 'false' }; // «Комплекти» — окремий пункт меню, тут лише звичайні товари
      if (q) params.q = q;
      if (categoryId) params.categoryId = categoryId;
      if (supplierId) params.supplierId = supplierId;
      const [p, c, s] = await Promise.all([api.listProducts(params), api.listCategories(), api.listSuppliers()]);
      setItems(p.data); setCategories(c.data); setSuppliers(s.data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [q, categoryId, supplierId]);

  async function handleDelete(id) {
    if (!confirm('Видалити товар?')) return;
    try { await api.deleteProduct(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Товари" action={<Button onClick={() => setEditing({})}>+ Товар</Button>} />
      <ErrorBanner message={error} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Пошук за назвою/sku…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-xs" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Усі категорії</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="max-w-xs" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Усі постачальники</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>

      {items === null ? null : items.length === 0 ? (
        <EmptyState
          title="Товарів ще немає"
          action={<div className="flex gap-2"><Button onClick={() => setEditing({})}>+ Товар</Button><Button variant="secondary" disabled title="Скоро">Або імпортувати з KeyCRM</Button></div>}
        />
      ) : (
        <Card>
          {/* mobile: картки */}
          <div className="divide-y divide-slate-800/60 md:hidden">
            {items.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-4" onClick={() => setEditing(p)}>
                <Thumb url={p.thumbnailUrl} />
                <div className="flex-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-slate-500">{p.sku} · {money(p.price)}</div>
                </div>
                <IconButton onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}>🗑️</IconButton>
              </div>
            ))}
          </div>
          {/* desktop: таблиця */}
          <table className="hidden w-full table-fixed text-sm md:table">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="w-[12%] px-4 py-3"></th><th className="w-[22%] px-4 py-3">Назва</th><th className="w-[12%] px-4 py-3">Артикул</th><th className="w-[14%] px-4 py-3">Категорія</th>
                <th className="w-[12%] px-4 py-3">Ціна</th><th className="w-[10%] px-4 py-3">Варіантів</th><th className="w-[14%] px-4 py-3">Постачальник</th><th className="w-[8%] px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30" onClick={() => setEditing(p)}>
                  <td className="px-4 py-3"><Thumb url={p.thumbnailUrl} /></td>
                  <td className="truncate px-4 py-3" title={p.name}>{p.name}</td>
                  <td className="truncate px-4 py-3 text-slate-400">{p.sku}</td>
                  <td className="truncate px-4 py-3 text-slate-400">{p.category?.name || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{money(p.price)}</td>
                  <td className="px-4 py-3 text-slate-400">{p.offersCount}</td>
                  <td className="truncate px-4 py-3 text-slate-400">{p.supplier?.name || '—'}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5">
                      <IconButton onClick={() => setEditing(p)}>✏️</IconButton>
                      <IconButton onClick={() => handleDelete(p.id)}>🗑️</IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing !== null && (
        <ProductFormModal
          product={editing.id ? editing : null}
          categories={categories}
          suppliers={suppliers}
          allProducts={items || []}
          onClose={() => setEditing(null)}
          onSaved={load}
          onSupplierCreated={async (data) => {
            try { const created = (await api.createSupplier(data)).data; await load(); return created; }
            catch (e) { alert(e.message); return null; }
          }}
        />
      )}
    </div>
  );
}

function Thumb({ url }) {
  return url
    ? <img src={url} alt="" className="h-28 w-28 rounded-md object-cover" />
    : <div className="flex h-28 w-28 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>;
}
