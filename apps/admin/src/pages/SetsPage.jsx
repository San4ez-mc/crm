// «Комплекти» — окремий пункт меню, технічно ті самі Product з isSet=true (не категорія).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Input, Card, EmptyState, ErrorBanner, money } from '../components/common/Common';
import ProductFormModal from './ProductFormModal';

export default function SetsPage() {
  const [items, setItems] = useState(null);
  const [allProducts, setAllProducts] = useState([]); // для вибору складу комплекту — БЕЗ фільтра isSet
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  async function load() {
    setError('');
    try {
      const params = { isSet: 'true' };
      if (q) params.q = q;
      const [p, all, c, s] = await Promise.all([api.listProducts(params), api.listProducts({}), api.listCategories(), api.listSuppliers()]);
      setItems(p.data); setAllProducts(all.data); setCategories(c.data); setSuppliers(s.data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [q]);

  async function handleDelete(id) {
    if (!confirm('Видалити комплект?')) return;
    try { await api.deleteProduct(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Комплекти" action={<Button onClick={() => setEditing({ isSet: true })}>+ Комплект</Button>} />
      <ErrorBanner message={error} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Пошук за назвою/артикулом…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Комплектів ще немає" action={<Button onClick={() => setEditing({ isSet: true })}>+ Комплект</Button>} />
      ) : (
        <Card>
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="w-48 px-4 py-3">Назва</th><th className="w-24 px-4 py-3">Артикул</th>
                <th className="w-28 px-4 py-3">Ціна</th><th className="px-4 py-3">Складається з</th><th className="w-20 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30" onClick={() => setEditing(p)}>
                  <td className="truncate px-4 py-3">{p.name}</td>
                  <td className="truncate px-4 py-3 text-slate-400">{p.sku}</td>
                  <td className="whitespace-nowrap px-4 py-3">{money(p.price)}</td>
                  <td className="truncate px-4 py-3 text-slate-400">{(p.setComponents || []).map((c) => c.name).join(', ') || '—'}</td>
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
          forceSet
          categories={categories}
          suppliers={suppliers}
          allProducts={allProducts}
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
