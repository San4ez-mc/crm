// Редагування складу й доставки замовлення (2026-10-02, власник). Менеджер відкриває замовлення кнопкою
// «✏️ Редагувати замовлення» під сповіщенням у Telegram, правит тут, а «📦 Оформити постачальнику» (Flows)
// бере позиції й доставку саме з CRM. Комплект лишається ОДНИМ рядком (виручка/собівартість по комплекту),
// а його склад (колір/розмір кожної речі) — у components цього рядка.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Input, Select, Button, Badge, ErrorBanner, money } from '../components/common/Common';

const COLOR_RE = /кол|цвет|color/i;
const SIZE_RE = /розм|разм|size/i;

function propValue(props, re) {
  const p = (Array.isArray(props) ? props : []).find((x) => re.test(x?.name || ''));
  return p ? String(p.value || '') : '';
}
function offerColor(o) { return propValue(o?.properties, COLOR_RE); }
function colorsOf(product) {
  return [...new Set((product?.offers || []).map(offerColor).filter(Boolean))];
}
function sizesOf(product, color) {
  const offer = (product?.offers || []).find((o) => offerColor(o) === color);
  const fromOffer = offer?.effectiveSizes || offer?.availableSizes || [];
  return fromOffer.length ? fromOffer : (product?.sizes || []);
}
function offerFor(product, color) {
  const offers = product?.offers || [];
  return offers.find((o) => offerColor(o) === color) || (offers.length === 1 ? offers[0] : null);
}

function fromOrderItem(it) {
  return {
    key: it.id || Math.random().toString(36).slice(2),
    productId: it.productId || '',
    offerId: it.offerId || '',
    name: it.name || '',
    price: Number(it.price) || 0,
    quantity: it.quantity || 1,
    color: propValue(it.properties, COLOR_RE),
    size: propValue(it.properties, SIZE_RE),
    isUpsell: !!it.isUpsell,
    otherProps: (Array.isArray(it.properties) ? it.properties : []).filter((p) => !COLOR_RE.test(p?.name || '') && !SIZE_RE.test(p?.name || '')),
    components: Array.isArray(it.components) ? it.components.map((c) => ({ ...c })) : null,
  };
}
function componentsFromSet(product, productsById) {
  return (product?.setComponents || []).map((sc) => {
    const cp = productsById.get(sc.productId);
    const colors = colorsOf(cp);
    return { productId: sc.productId, sku: sc.sku || cp?.sku || '', name: sc.name || cp?.name || '', color: sc.fixedColor || (colors.length === 1 ? colors[0] : ''), size: '', qty: sc.qty || 1 };
  });
}

// Колір/розмір з варіантів товару (якщо в каталозі є варіанти) або вільним текстом.
function ColorSizeFields({ product, color, size, onChange }) {
  const colors = colorsOf(product);
  const sizes = sizesOf(product, color);
  return (
    <>
      {colors.length ? (
        <Select value={color} onChange={(e) => onChange({ color: e.target.value })}>
          <option value="">— колір —</option>
          {color && !colors.includes(color) && <option value={color}>{color} (немає в каталозі)</option>}
          {colors.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      ) : <Input placeholder="Колір" value={color} onChange={(e) => onChange({ color: e.target.value })} />}
      {sizes.length ? (
        <Select value={size} onChange={(e) => onChange({ size: e.target.value })}>
          <option value="">— розмір —</option>
          {size && !sizes.includes(size) && <option value={size}>{size} (немає для цього кольору)</option>}
          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      ) : <Input placeholder="Розмір" value={size} onChange={(e) => onChange({ size: e.target.value })} />}
    </>
  );
}

export default function OrderEditor({ order, onSaved, onCancel }) {
  const [products, setProducts] = useState([]);
  const [items, setItems] = useState(() => order.items.map(fromOrderItem));
  const sh = order.shipping || {};
  const [shipping, setShipping] = useState({
    recipientFullName: sh.recipientFullName || order.buyer?.fullName || '',
    recipientPhone: sh.recipientPhone || order.buyer?.phone || '',
    city: sh.city || '',
    branch: sh.branch || sh.warehouse || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api.listProducts({ take: '1000' }).then((r) => setProducts(r.data || [])).catch((e) => setError('Не вдалося завантажити каталог: ' + e.message)); }, []);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // Старі замовлення-комплекти без складу: підставляємо склад з картки комплекту (колір — зафіксований у комплекті або єдиний).
  useEffect(() => {
    if (!products.length) return;
    setItems((prev) => prev.map((it) => {
      const p = byId.get(it.productId);
      if (p?.isSet && !(it.components && it.components.length)) return { ...it, components: componentsFromSet(p, byId) };
      return it;
    }));
  }, [products, byId]);

  function update(key, patch) { setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it))); }
  function updateComponent(key, idx, patch) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, components: it.components.map((c, i) => (i === idx ? { ...c, ...patch } : c)) } : it)));
  }
  function removeComponent(key, idx) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, components: it.components.filter((_, i) => i !== idx) } : it)));
  }
  function pickProduct(key, productId) {
    const p = byId.get(productId);
    if (!p) return;
    const colors = colorsOf(p);
    update(key, { productId, offerId: '', name: p.name, price: Number(p.price) || 0, color: colors.length === 1 ? colors[0] : '', size: '', components: p.isSet ? componentsFromSet(p, byId) : null });
  }
  function addItem() {
    setItems((prev) => [...prev, { key: Math.random().toString(36).slice(2), productId: '', offerId: '', name: '', price: 0, quantity: 1, color: '', size: '', isUpsell: false, otherProps: [], components: null }]);
  }

  const total = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);

  async function save() {
    setError('');
    if (!items.length) { setError('У замовленні має лишитись хоча б одна позиція'); return; }
    if (items.some((it) => !it.name.trim())) { setError('Оберіть товар у кожному рядку'); return; }
    if (!shipping.city.trim() || !shipping.branch.trim()) { setError('Вкажіть місто й відділення Нової Пошти'); return; }
    setSaving(true);
    try {
      const payload = items.map((it) => {
        const p = byId.get(it.productId);
        const offer = p && !p.isSet ? offerFor(p, it.color) : null;
        return {
          productId: it.productId || null,
          offerId: offer ? offer.id : (it.color ? null : it.offerId || null),
          name: it.name,
          price: Number(it.price) || 0,
          quantity: Number(it.quantity) || 1,
          isUpsell: it.isUpsell,
          properties: [
            ...(it.size ? [{ name: 'Розмір', value: it.size }] : []),
            ...(it.color ? [{ name: 'Колір', value: it.color }] : []),
            ...it.otherProps,
          ],
          components: it.components && it.components.length ? it.components : undefined,
        };
      });
      await api.replaceOrderItems(order.id, payload);
      const r = await api.updateOrder(order.id, { shipping: { ...sh, shippingService: sh.shippingService || 'Нова Пошта', ...shipping, warehouse: shipping.branch } });
      onSaved(r.data);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 text-sm">
      <ErrorBanner message={error} />
      <section>
        <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Товари</h4>
        <div className="space-y-2">
          {items.map((it) => {
            const p = byId.get(it.productId);
            return (
              <div key={it.key} className="rounded-lg border border-slate-800 p-2">
                <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(0,2.4fr)_repeat(2,minmax(0,1fr))_70px_90px_auto]">
                  <Select value={it.productId} onChange={(e) => pickProduct(it.key, e.target.value)}>
                    <option value="">{it.productId ? it.name : '— оберіть товар —'}</option>
                    {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                  {p?.isSet
                    ? <div className="col-span-2 self-center text-xs text-slate-400">Комплект — колір і розмір по кожній речі нижче</div>
                    : <ColorSizeFields product={p} color={it.color} size={it.size} onChange={(patch) => update(it.key, patch)} />}
                  <Input type="number" min="1" title="Кількість" value={it.quantity} onChange={(e) => update(it.key, { quantity: e.target.value })} />
                  <Input type="number" min="0" title="Ціна за 1 шт." value={it.price} onChange={(e) => update(it.key, { price: e.target.value })} />
                  <button type="button" title="Прибрати позицію" onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))} className="px-2 text-slate-500 hover:text-red-400">✕</button>
                </div>
                {it.isUpsell && <div className="mt-1"><Badge color="teal">Допродаж</Badge></div>}
                {it.components && it.components.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-l-2 border-slate-700 pl-3">
                    {it.components.map((c, i) => (
                      <div key={i} className="grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))_70px_auto]">
                        <div className="self-center text-slate-300">{c.name}{c.sku ? <span className="ml-1 text-xs text-slate-500">{c.sku}</span> : null}</div>
                        <ColorSizeFields product={byId.get(c.productId)} color={c.color} size={c.size} onChange={(patch) => updateComponent(it.key, i, patch)} />
                        <Input type="number" min="1" title="Кількість" value={c.qty} onChange={(e) => updateComponent(it.key, i, { qty: e.target.value })} />
                        <button type="button" title="Прибрати з комплекту" onClick={() => removeComponent(it.key, i)} className="px-2 text-slate-500 hover:text-red-400">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={addItem} className="text-xs text-brand-light hover:underline">+ Додати товар</button>
          <span className="text-slate-300">Разом: {money(total)}</span>
        </div>
      </section>

      <section>
        <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Доставка (Нова Пошта)</h4>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <Input placeholder="ПІБ отримувача" value={shipping.recipientFullName} onChange={(e) => setShipping({ ...shipping, recipientFullName: e.target.value })} />
          <Input placeholder="Телефон" value={shipping.recipientPhone} onChange={(e) => setShipping({ ...shipping, recipientPhone: e.target.value })} />
          <Input placeholder="Місто" value={shipping.city} onChange={(e) => setShipping({ ...shipping, city: e.target.value })} />
          <Input placeholder="Відділення / поштомат (номер)" value={shipping.branch} onChange={(e) => setShipping({ ...shipping, branch: e.target.value })} />
        </div>
      </section>

      <p className="text-xs text-slate-500">Оплату (передоплату) тут не змінюємо — якщо змінилась сума, напишіть клієнту окремо. Постачальнику піде саме те, що збережено тут.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button onClick={save} disabled={saving}>{saving ? 'Зберігаю…' : 'Зберегти зміни'}</Button>
      </div>
    </div>
  );
}
