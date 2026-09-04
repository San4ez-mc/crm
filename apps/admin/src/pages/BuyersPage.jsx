// §9.9/§9.10 Покупці — список + картка.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Input, Card, EmptyState, ErrorBanner, Field, Label, Button, Pagination, money, formatPhone } from '../components/common/Common';
import Modal from '../components/common/Modal';

const PAGE_SIZE = 50;

export default function BuyersPage() {
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  async function load() {
    setError('');
    try {
      const params = { take: String(PAGE_SIZE), skip: String((page - 1) * PAGE_SIZE) };
      if (q) params.q = q;
      const { data, meta } = await api.listBuyers(params);
      setItems(data); setTotal(meta.total);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [q, page]);
  useEffect(() => { setPage(1); }, [q]);

  return (
    <div>
      <PageHeader title="Покупці" />
      <ErrorBanner message={error} />
      <div className="mb-4"><Input className="max-w-xs" placeholder="Пошук за імʼям/телефоном…" value={q} onChange={(e) => setQ(e.target.value)} /></div>

      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Покупців ще немає" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Імʼя</th><th className="px-4 py-3">Телефон</th><th className="px-4 py-3">Instagram</th><th className="px-4 py-3">Замовлень</th><th className="px-4 py-3">Сума покупок</th><th className="px-4 py-3">Останнє замовлення</th></tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30" onClick={() => setSelected(b)}>
                  <td className="px-4 py-3">{b.fullName || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{formatPhone(b.phone)}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    {b.igUsername ? <a className="text-brand-light hover:underline" href={`https://instagram.com/${b.igUsername}`} target="_blank" rel="noreferrer">@{b.igUsername}</a> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3">{b.ordersCount}</td>
                  <td className="px-4 py-3">{money(b.totalSpent)}</td>
                  <td className="px-4 py-3 text-slate-400">{b.lastOrderAt ? new Date(b.lastOrderAt).toLocaleDateString('uk-UA') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />

      {selected && <BuyerDetailModal id={selected.id} onClose={() => setSelected(null)} onSaved={load} />}
    </div>
  );
}

// Рядки для довільних вимірів клієнта {[назва]: значення} — той самий патерн, що
// RequiredParamsEditor у CategoriesPage: add/edit/delete рядків без фіксованої схеми,
// бо параметри різні для різних категорій товару (зріст/вага, розмір ноги тощо).
function MeasurementsEditor({ value, onChange }) {
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
          <Input className="w-28 !py-1 text-xs" placeholder="Назва" value={k} onChange={(e) => setRow(i, e.target.value, v)} />
          <Input className="!py-1 text-xs" placeholder="Значення" value={v} onChange={(e) => setRow(i, k, e.target.value)} />
          <button type="button" onClick={() => removeRow(i)} className="px-1 text-slate-500 hover:text-red-400">✕</button>
        </div>
      ))}
      <button type="button" onClick={addRow} className="text-xs text-brand-light hover:underline">+ Додати вимір</button>
    </div>
  );
}

function BuyerDetailModal({ id, onClose, onSaved }) {
  const [buyer, setBuyer] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getBuyer(id).then((r) => {
      setBuyer(r.data);
      setForm({
        fullName: r.data.fullName || '',
        phone: r.data.phone || '',
        igUsername: r.data.igUsername || '',
        knownMeasurements: r.data.knownMeasurements || {},
        shippingFullName: r.data.knownShipping?.fullName || '',
        shippingPhone: r.data.knownShipping?.phone || '',
        shippingCity: r.data.knownShipping?.city || '',
        shippingWarehouse: r.data.knownShipping?.warehouse || '',
      });
    });
  }, [id]);

  if (!buyer || !form) return null;
  const totalSpent = buyer.orders.reduce((s, o) => s + o.items.reduce((a, it) => a + Number(it.price) * it.quantity, 0), 0);

  async function save() {
    setSaving(true); setError('');
    try {
      await api.updateBuyer(id, {
        fullName: form.fullName || null,
        phone: form.phone,
        igUsername: form.igUsername || null,
        knownMeasurements: Object.keys(form.knownMeasurements).length ? form.knownMeasurements : null,
        knownShipping: (form.shippingFullName || form.shippingPhone || form.shippingCity || form.shippingWarehouse)
          ? { fullName: form.shippingFullName, phone: form.shippingPhone, city: form.shippingCity, warehouse: form.shippingWarehouse }
          : null,
      });
      onSaved?.();
      onClose();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Modal isOpen title="Картка покупця" onClose={onClose} wide>
      <ErrorBanner message={error} />

      {/* Зверху — вся збережена інформація про клієнта (редагована): звідси її підхоплює
          воронка на повторному замовленні, щоб не питати те саме вдруге. */}
      <section className="mb-5">
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Дані клієнта</h4>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Імʼя"><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label="Телефон"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Instagram"><Input value={form.igUsername} onChange={(e) => setForm({ ...form, igUsername: e.target.value })} placeholder="username без @" /></Field>
        </div>
        <div className="mt-2 text-xs text-slate-500">Сума покупок: {money(totalSpent)} · Повернень: {buyer.orders.flatMap((o) => o.returns).length}</div>
      </section>

      <section className="mb-5">
        <Label>Виміри (зріст/вага/розмір тощо — підказка воронці при підборі розміру)</Label>
        <MeasurementsEditor value={form.knownMeasurements} onChange={(v) => setForm({ ...form, knownMeasurements: v })} />
      </section>

      <section className="mb-5">
        <Label>Реквізити доставки (Нова Пошта) — запам'ятовуються з останнього замовлення</Label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="ПІБ отримувача"><Input value={form.shippingFullName} onChange={(e) => setForm({ ...form, shippingFullName: e.target.value })} /></Field>
          <Field label="Телефон отримувача"><Input value={form.shippingPhone} onChange={(e) => setForm({ ...form, shippingPhone: e.target.value })} /></Field>
          <Field label="Місто"><Input value={form.shippingCity} onChange={(e) => setForm({ ...form, shippingCity: e.target.value })} /></Field>
          <Field label="Відділення / поштомат"><Input value={form.shippingWarehouse} onChange={(e) => setForm({ ...form, shippingWarehouse: e.target.value })} /></Field>
        </div>
      </section>

      <div className="mb-5 flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? 'Зберігаю…' : 'Зберегти'}</Button>
      </div>

      {/* Знизу — список замовлень цього клієнта. */}
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase text-slate-500">Замовлення</h4>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
            <tr><th className="py-2">Дата</th><th className="py-2">Товари</th><th className="py-2">Сума</th><th className="py-2">Стадія</th></tr>
          </thead>
          <tbody>
            {buyer.orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-800/60 last:border-0">
                <td className="py-2 text-slate-400">{new Date(o.createdAt).toLocaleDateString('uk-UA')}</td>
                <td className="py-2">{o.items.map((it) => it.name).join(', ')}</td>
                <td className="py-2">{money(o.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0))}</td>
                <td className="py-2 text-slate-400">{o.stage?.name || '—'}</td>
              </tr>
            ))}
            {buyer.orders.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-slate-500">Замовлень ще немає.</td></tr>}
          </tbody>
        </table>
      </section>
    </Modal>
  );
}
