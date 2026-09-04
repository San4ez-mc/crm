// Ручне створення замовлення (2026-09-04, за проханням власника) — на випадок, коли
// менеджер оформлює замовлення сам (телефонний дзвінок, доручення тощо), не через воронку.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Field, Input, Select, Button, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';

function emptyItem() { return { productId: '', name: '', price: '', quantity: 1, color: '', size: '' }; }

export default function NewOrderModal({ stages, ads, onClose, onCreated }) {
  const [products, setProducts] = useState([]);
  const [buyer, setBuyer] = useState({ fullName: '', phone: '', igUsername: '' });
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [adId, setAdId] = useState('');
  const [shipping, setShipping] = useState({ city: '', warehouse: '' });
  const [items, setItems] = useState([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.listProducts({ take: '500' }).then((r) => setProducts(r.data)).catch(() => {}); }, []);

  function updateItem(i, patch) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function pickProduct(i, productId) {
    const p = products.find((x) => x.id === productId);
    updateItem(i, { productId, name: p?.name || '', price: p?.price || '' });
  }
  function addItem() { setItems((prev) => [...prev, emptyItem()]); }
  function removeItem(i) { setItems((prev) => prev.filter((_, idx) => idx !== i)); }

  async function save() {
    setError('');
    if (!buyer.phone.trim()) { setError('Телефон покупця обовʼязковий'); return; }
    if (!items.length || items.some((it) => !it.name.trim())) { setError('Оберіть товар у кожному рядку'); return; }
    setSaving(true);
    try {
      await api.createOrder({
        buyer: { fullName: buyer.fullName || undefined, phone: buyer.phone, igUsername: buyer.igUsername || undefined },
        stageId: stageId || undefined,
        firstTouchAdId: adId || undefined,
        shipping: (shipping.city || shipping.warehouse) ? shipping : undefined,
        items: items.map((it) => ({
          productId: it.productId || undefined,
          name: it.name,
          price: Number(it.price) || 0,
          quantity: Number(it.quantity) || 1,
          properties: (it.color || it.size) ? [
            ...(it.color ? [{ name: 'Колір', value: it.color }] : []),
            ...(it.size ? [{ name: 'Розмір', value: it.size }] : []),
          ] : undefined,
        })),
      });
      onCreated();
      onClose();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal isOpen title="Нове замовлення (вручну)" onClose={onClose} wide>
      <ErrorBanner message={error} />

      <section className="mb-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Покупець</h4>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Імʼя"><Input value={buyer.fullName} onChange={(e) => setBuyer({ ...buyer, fullName: e.target.value })} /></Field>
          <Field label="Телефон *"><Input value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} placeholder="+380..." /></Field>
          <Field label="Instagram"><Input value={buyer.igUsername} onChange={(e) => setBuyer({ ...buyer, igUsername: e.target.value })} placeholder="username без @" /></Field>
        </div>
      </section>

      <section className="mb-4">
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Товари</h4>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-1 gap-1.5 rounded-lg border border-slate-800 p-2 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
              <Select value={it.productId} onChange={(e) => pickProduct(i, e.target.value)}>
                <option value="">— оберіть товар —</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <Input placeholder="Ціна" type="number" value={it.price} onChange={(e) => updateItem(i, { price: e.target.value })} />
              <Input placeholder="К-сть" type="number" min="1" value={it.quantity} onChange={(e) => updateItem(i, { quantity: e.target.value })} />
              <Input placeholder="Колір" value={it.color} onChange={(e) => updateItem(i, { color: e.target.value })} />
              <Input placeholder="Розмір" value={it.size} onChange={(e) => updateItem(i, { size: e.target.value })} />
              <button type="button" onClick={() => removeItem(i)} className="px-2 text-slate-500 hover:text-red-400">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="mt-2 text-xs text-brand-light hover:underline">+ Додати товар</button>
      </section>

      <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Стадія">
          <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Джерело (реклама, опційно)">
          <Select value={adId} onChange={(e) => setAdId(e.target.value)}>
            <option value="">— органіка / невідомо —</option>
            {ads.map((a) => <option key={a.id} value={a.id}>{a.name || a.externalId || a.id.slice(0, 8)}</option>)}
          </Select>
        </Field>
        <Field label="Місто (Нова Пошта)"><Input value={shipping.city} onChange={(e) => setShipping({ ...shipping, city: e.target.value })} /></Field>
        <Field label="Відділення / поштомат"><Input value={shipping.warehouse} onChange={(e) => setShipping({ ...shipping, warehouse: e.target.value })} /></Field>
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Скасувати</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Створюю…' : 'Створити замовлення'}</Button>
      </div>
    </Modal>
  );
}
