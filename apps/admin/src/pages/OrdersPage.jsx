// §9.7 Замовлення — основний робочий екран менеджера. Перемикач Дошка/Таблиця.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Input, Select, Card, EmptyState, ErrorBanner, Badge, money } from '../components/common/Common';
import Modal from '../components/common/Modal';
import OrderDetailModal from './OrderDetailModal';
import { ReturnForm } from './ReturnsPage';

export default function OrdersPage() {
  const [view, setView] = useState('board');
  const [orders, setOrders] = useState(null);
  const [pipelines, setPipelines] = useState([]);
  const [ads, setAds] = useState([]);
  const [q, setQ] = useState('');
  const [stageId, setStageId] = useState('');
  const [adId, setAdId] = useState('');
  const [error, setError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [returnForOrder, setReturnForOrder] = useState(null);

  useEffect(() => { api.listAds().then((r) => setAds(r.data)).catch(() => {}); }, []);

  async function load() {
    setError('');
    try {
      const params = {};
      if (q) params.q = q;
      if (stageId) params.stageId = stageId;
      if (adId) params.adId = adId;
      const [o, p] = await Promise.all([api.listOrders(params), api.listPipelines()]);
      setOrders(o.data); setPipelines(p.data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [q, stageId, adId]);

  const stages = pipelines.flatMap((p) => p.stages);

  async function moveOrderToStage(orderId, newStageId) {
    try { await api.updateOrder(orderId, { stageId: newStageId }); load(); } catch (e) { alert(e.message); }
  }

  function orderTotal(order) {
    return order.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  }

  return (
    <div>
      <PageHeader
        title="Замовлення"
        action={
          <div className="flex gap-2">
            <Select className="!w-auto" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="board">Дошка</option>
              <option value="table">Таблиця</option>
            </Select>
          </div>
        }
      />
      <ErrorBanner message={error} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Пошук за покупцем/телефоном/ТТН…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-xs" value={stageId} onChange={(e) => setStageId(e.target.value)}>
          <option value="">Усі стадії</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select className="max-w-xs" value={adId} onChange={(e) => setAdId(e.target.value)}>
          <option value="">Усі оголошення</option>
          {ads.map((a) => <option key={a.id} value={a.id}>{a.name || a.externalId || a.id.slice(0, 8)}</option>)}
        </Select>
      </div>

      {orders === null ? null : orders.length === 0 ? (
        <EmptyState title="Замовлень ще немає" hint="Вони приходять автоматично з воронки після оформлення клієнтом." />
      ) : view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((stage) => (
            <div key={stage.id} className="w-72 shrink-0"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const id = e.dataTransfer.getData('orderId'); if (id) moveOrderToStage(id, stage.id); }}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium">{stage.name}</span>
                <span className="text-xs text-slate-500">{orders.filter((o) => o.stageId === stage.id).length}</span>
              </div>
              <div className="space-y-2">
                {orders.filter((o) => o.stageId === stage.id).map((o) => (
                  <Card key={o.id} className="cursor-pointer p-3 hover:border-brand"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('orderId', o.id)}
                    onClick={() => setSelectedOrder(o)}
                  >
                    <div className="text-sm font-medium">{o.buyer?.fullName || o.buyer?.phone || 'Без покупця'}</div>
                    {o.buyer?.igUsername && <div className="text-xs text-brand-light">@{o.buyer.igUsername}</div>}
                    <div className="mt-1 text-xs text-slate-500 line-clamp-1">{o.items.map((it) => it.name).join(', ')}</div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-sm">{money(orderTotal(o))}</span>
                      {o.ttnStatus && <Badge color="green">{o.ttnStatus}</Badge>}
                    </div>
                    {o.firstTouchAd?.name && <div className="mt-1 truncate text-[11px] text-slate-500" title={o.firstTouchAd.name}>📢 {o.firstTouchAd.name}</div>}
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Покупець</th><th className="px-4 py-3">Товари</th><th className="px-4 py-3">Сума</th><th className="px-4 py-3">Стадія</th><th className="px-4 py-3">ТТН</th><th className="px-4 py-3">Джерело</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30" onClick={() => setSelectedOrder(o)}>
                  <td className="px-4 py-3 text-slate-400">{new Date(o.createdAt).toLocaleDateString('uk-UA')}</td>
                  <td className="px-4 py-3">{o.buyer?.fullName || o.buyer?.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{o.items.map((it) => it.name).join(', ')}</td>
                  <td className="px-4 py-3">{money(orderTotal(o))}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <Select className="!w-auto py-1" value={o.stageId || ''} onChange={(e) => moveOrderToStage(o.id, e.target.value)}>
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{o.ttn?.join(', ') || '—'} {o.ttnStatus && <Badge color="green">{o.ttnStatus}</Badge>}</td>
                  <td className="px-4 py-3 text-slate-400">{o.firstTouchAd?.name || o.sourceName || 'органіка'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          pipelines={pipelines}
          onClose={() => setSelectedOrder(null)}
          onChanged={() => { load(); }}
          onOpenReturn={(o) => { setReturnForOrder(o); setSelectedOrder(null); }}
        />
      )}

      <Modal isOpen={!!returnForOrder} title="Оформити повернення/обмін" onClose={() => setReturnForOrder(null)}>
        {returnForOrder && (
          <ReturnForm
            orderId={returnForOrder.id}
            onCancel={() => setReturnForOrder(null)}
            onSave={async (data) => { await api.createReturn(data); setReturnForOrder(null); load(); }}
          />
        )}
      </Modal>
    </div>
  );
}
