// §9.3 Товар — картка/форма (створення й редагування). Дві колонки: ліва — основні поля,
// права — розмірна сітка + варіанти (offers), фото через реальний upload-сервіс (POST /api/uploads).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Field, Input, Textarea, Select, Button, IconButton, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';
import { SupplierForm } from './SuppliersPage';
import { SingleFileDrop, MultiImageDrop } from '../components/common/FileDropInput';

function TagsInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  function commit() {
    const v = draft.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
  }
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-1.5">
      <div className="mb-1 flex flex-wrap gap-1">
        {value.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-xs">
            {t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="text-slate-400 hover:text-white">✕</button>
          </span>
        ))}
      </div>
      <input
        className="w-full bg-transparent px-1 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
      />
    </div>
  );
}

function MultiProductSelect({ allProducts, excludeId, value, onChange }) {
  const options = allProducts.filter((p) => p.id !== excludeId);
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap gap-1">
        {value.map((id) => {
          const p = options.find((x) => x.id === id);
          return (
            <span key={id} className="flex items-center gap-1 rounded-md bg-slate-700 px-2 py-0.5 text-xs">
              {p?.name || id}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} className="text-slate-400 hover:text-white">✕</button>
            </span>
          );
        })}
      </div>
      <Select value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}>
        <option value="">+ додати товар…</option>
        {options.filter((p) => !value.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
      </Select>
    </div>
  );
}

export default function ProductFormModal({ product, categories, suppliers, allProducts, onClose, onSaved, onSupplierCreated }) {
  const isEdit = !!product?.id;
  const [form, setForm] = useState({
    name: product?.name || '', sku: product?.sku || '', price: product?.price || '', minPrice: product?.minPrice || '',
    categoryId: product?.categoryId || '', presentationText: product?.presentationText || '',
    adMatchTokens: product?.adMatchTokens || [], companionProductIds: product?.companionProductIds || [],
    supplierId: product?.supplierId || '', supplierArticle: product?.supplierArticle || '', sizeChartImage: product?.sizeChartImage || '',
    thumbnailUrl: product?.thumbnailUrl || '', images: product?.images || [], aiNotes: product?.aiNotes || '',
    bulkPricing: product?.bulkPricing || [], isSet: !!product?.isSet,
  });
  const [offers, setOffers] = useState(product?.offers || []);
  const [setComponents, setSetComponentsState] = useState((product?.setComponents || []).map((c) => c.productId));
  const [error, setError] = useState('');
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [savedProductId, setSavedProductId] = useState(product?.id || null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      if (!form.name.trim() || !form.sku.trim() || !form.price) throw new Error('Назва, артикул і ціна обовʼязкові');
      const { bulkPricing, isSet, ...rest } = form;
      const payload = { ...rest, bulkPricing, isSet, price: Number(form.price), minPrice: form.minPrice ? Number(form.minPrice) : null, categoryId: form.categoryId || null, supplierId: form.supplierId || null };
      const saved = isEdit ? (await api.updateProduct(product.id, payload)).data : (await api.createProduct(payload)).data;
      setSavedProductId(saved.id);
      if (isEdit && isSet) {
        await api.setSetComponents(saved.id, setComponents.map((componentProductId) => ({ componentProductId, qty: 1 })));
      }
      onSaved();
      if (!isEdit) onClose(); // для нового товару — офери/склад комплекту додаються після повторного відкриття (простіше й надійніше)
    } catch (e) { setError(e.message); }
  }

  async function addOffer() {
    if (!savedProductId) { setError('Спершу збережіть товар'); return; }
    try {
      const created = (await api.createOffer(savedProductId, { properties: [], images: [] })).data;
      setOffers([...offers, created]);
    } catch (e) { setError(e.message); }
  }

  async function updateOfferField(offer, field, value) {
    const next = { ...offer, [field]: value };
    setOffers(offers.map((o) => (o.id === offer.id ? next : o)));
    try { await api.updateOffer(offer.id, { [field]: value }); } catch (e) { setError(e.message); }
  }

  async function removeOffer(id) {
    try { await api.deleteOffer(id); setOffers(offers.filter((o) => o.id !== id)); } catch (e) { setError(e.message); }
  }

  return (
    <Modal isOpen title={isEdit ? `Редагувати: ${product.name}` : 'Новий товар'} onClose={onClose} wide>
      <ErrorBanner message={error} />
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <Field label="Назва"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Артикул (sku)"><Input required value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
            <Field label="Ціна"><Input required type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
          </div>
          <Field label="Мін. ціна"><Input type="number" step="0.01" value={form.minPrice} onChange={(e) => setForm({ ...form, minPrice: e.target.value })} /></Field>
          <Field label="Ціна за кількість (та сама для всіх кольорів)">
            <BulkPricingEditor value={form.bulkPricing} onChange={(v) => setForm({ ...form, bulkPricing: v })} />
          </Field>
          <Field label="Категорія">
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">— не вибрано —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.isSet} onChange={(e) => setForm({ ...form, isSet: e.target.checked })} />
            Це комплект (окремий пункт меню «Комплекти», не категорія)
          </label>
          {form.isSet && (
            <Field label="Товари, що входять у комплект">
              {isEdit
                ? <MultiProductSelect allProducts={allProducts} excludeId={product?.id} value={setComponents} onChange={setSetComponentsState} />
                : <p className="text-xs text-slate-500">Спершу збережіть комплект, потім відкрийте його знову, щоб вибрати склад.</p>}
            </Field>
          )}
          <Field label="Мініатюра (для списку товарів)">
            <SingleFileDrop value={form.thumbnailUrl} onChange={(url) => setForm({ ...form, thumbnailUrl: url })} />
          </Field>
          <Field label="Презентація для клієнта">
            <Textarea rows={3} placeholder="Пишіть так, як має прозвучати для клієнта, а не сухий CRM-опис" value={form.presentationText} onChange={(e) => setForm({ ...form, presentationText: e.target.value })} />
          </Field>
          <Field label="Нотатки для ШІ (не показуються клієнту)">
            <Textarea rows={2} placeholder="Напр. умови повернення, застереження — те, що бот має знати, але не читати клієнту дослівно" value={form.aiNotes} onChange={(e) => setForm({ ...form, aiNotes: e.target.value })} />
          </Field>
          <Field label="Токени для матчингу за рекламою/артикулом">
            <TagsInput value={form.adMatchTokens} onChange={(v) => setForm({ ...form, adMatchTokens: v })} placeholder="Ввести й Enter" />
          </Field>
          <Field label="Допродажі (companion products)">
            <MultiProductSelect allProducts={allProducts} excludeId={product?.id} value={form.companionProductIds} onChange={(v) => setForm({ ...form, companionProductIds: v })} />
          </Field>
          <Field label="Постачальник">
            <div className="flex gap-2">
              <Select className="flex-1" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">— не вибрано —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Button type="button" variant="secondary" onClick={() => setShowNewSupplier(true)}>+ додати</Button>
            </div>
          </Field>
          <Field label="Артикул у постачальника"><Input value={form.supplierArticle} onChange={(e) => setForm({ ...form, supplierArticle: e.target.value })} /></Field>
        </div>

        <div>
          <Field label="Загальні фото товару (не привʼязані до кольору)">
            <MultiImageDrop value={form.images} onChange={(urls) => setForm({ ...form, images: urls })} />
          </Field>
          <Field label="Розмірна сітка">
            <SingleFileDrop value={form.sizeChartImage} onChange={(url) => setForm({ ...form, sizeChartImage: url })} />
          </Field>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <Label2>Варіанти (Offers)</Label2>
              <Button type="button" variant="secondary" onClick={addOffer}>+ Варіант</Button>
            </div>
            {!savedProductId && <p className="text-xs text-slate-500">Спершу збережіть товар, щоб додавати варіанти.</p>}
            <div className="space-y-3">
              {offers.map((offer) => (
                <div key={offer.id} className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Артикул варіанту"><Input defaultValue={offer.sku || ''} onBlur={(e) => updateOfferField(offer, 'sku', e.target.value)} /></Field>
                    <Field label="Кількість (свій запас на цей колір)"><Input type="number" defaultValue={offer.quantity ?? ''} onBlur={(e) => updateOfferField(offer, 'quantity', e.target.value === '' ? null : Number(e.target.value))} /></Field>
                  </div>
                  <Field label="Властивості (розмір:M, колір:чорний)">
                    <Input
                      defaultValue={(offer.properties || []).map((p) => `${p.name}:${p.value}`).join(', ')}
                      onBlur={(e) => updateOfferField(offer, 'properties', e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const [name, value] = s.split(':'); return { name: (name || '').trim(), value: (value || '').trim() }; }))}
                    />
                  </Field>
                  <Field label="Фото цього варіанту">
                    <MultiImageDrop value={offer.images || []} onChange={(urls) => updateOfferField(offer, 'images', urls)} />
                  </Field>
                  <div className="mt-2 flex justify-end">
                    <IconButton onClick={() => removeOffer(offer.id)}>🗑️</IconButton>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-full mt-2 flex justify-end gap-2 border-t border-slate-800 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Закрити</Button>
          <Button type="submit">Зберегти</Button>
        </div>
      </form>

      <Modal isOpen={showNewSupplier} title="Новий постачальник" onClose={() => setShowNewSupplier(false)}>
        <SupplierForm
          initial={{}}
          onCancel={() => setShowNewSupplier(false)}
          onSave={async (data) => {
            const created = await onSupplierCreated(data);
            if (created) setForm((f) => ({ ...f, supplierId: created.id }));
            setShowNewSupplier(false);
          }}
        />
      </Modal>
    </Modal>
  );
}

function Label2({ children }) { return <span className="text-sm font-medium text-slate-300">{children}</span>; }

function BulkPricingEditor({ value = [], onChange }) {
  function update(i, field, v) {
    const next = value.map((row, idx) => (idx === i ? { ...row, [field]: v } : row));
    onChange(next);
  }
  function remove(i) { onChange(value.filter((_, idx) => idx !== i)); }
  function add() { onChange([...value, { quantity: (value[value.length - 1]?.quantity || 1) + 1, price: '' }]); }
  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs text-slate-500">за {row.quantity || 0} шт</span>
          <Input type="number" min="2" placeholder="кількість" value={row.quantity ?? ''} onChange={(e) => update(i, 'quantity', Number(e.target.value))} />
          <Input type="number" step="0.01" placeholder="ціна" value={row.price ?? ''} onChange={(e) => update(i, 'price', Number(e.target.value))} />
          <IconButton onClick={() => remove(i)}>🗑️</IconButton>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={add}>+ Ціна за кількість</Button>
    </div>
  );
}
