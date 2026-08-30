// §9.9/§9.10 Покупці — список + картка.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Input, Card, EmptyState, ErrorBanner, money } from '../components/common/Common';
import Modal from '../components/common/Modal';

export default function BuyersPage() {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  async function load() {
    setError('');
    try { setItems((await api.listBuyers(q ? { q } : {})).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [q]);

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
                  <td className="px-4 py-3 text-slate-400">{b.phone}</td>
                  <td className="px-4 py-3 text-slate-400">{b.igUsername ? `@${b.igUsername}` : '—'}</td>
                  <td className="px-4 py-3">{b.ordersCount}</td>
                  <td className="px-4 py-3">{money(b.totalSpent)}</td>
                  <td className="px-4 py-3 text-slate-400">{b.lastOrderAt ? new Date(b.lastOrderAt).toLocaleDateString('uk-UA') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && <BuyerDetailModal id={selected.id} onClose={() => setSelected(null)} />}
    </div>
  );
}

function BuyerDetailModal({ id, onClose }) {
  const [buyer, setBuyer] = useState(null);
  useEffect(() => { api.getBuyer(id).then((r) => setBuyer(r.data)); }, [id]);
  if (!buyer) return null;
  const totalSpent = buyer.orders.reduce((s, o) => s + o.items.reduce((a, it) => a + Number(it.price) * it.quantity, 0), 0);
  return (
    <Modal isOpen title={buyer.fullName || buyer.phone} onClose={onClose} wide>
      <div className="mb-4 text-sm text-slate-400">
        {buyer.phone} {buyer.igUsername && `· @${buyer.igUsername}`} · Сума покупок: {money(totalSpent)} · Повернень: {buyer.orders.flatMap((o) => o.returns).length}
      </div>
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
        </tbody>
      </table>
    </Modal>
  );
}
