// §9.8 Замовлення — деталі (drawer/модалка з рядка списку).
import { useState } from 'react';
import { api } from '../api/client';
import { Field, Input, Textarea, Select, Button, Badge, ErrorBanner, money } from '../components/common/Common';
import Modal from '../components/common/Modal';

export default function OrderDetailModal({ order, pipelines, onClose, onChanged, onOpenReturn }) {
  const [managerComment, setManagerComment] = useState(order.managerComment || '');
  const [error, setError] = useState('');
  const stages = pipelines?.flatMap((p) => p.stages) || [];

  async function saveComment() {
    try { await api.updateOrder(order.id, { managerComment }); onChanged(); } catch (e) { setError(e.message); }
  }
  async function changeStage(stageId) {
    try { await api.updateOrder(order.id, { stageId }); onChanged(); } catch (e) { setError(e.message); }
  }
  async function refreshTtn() {
    alert('Форс-запит до API Нової Пошти виконує окрема Flows-автоматизація — тут лише відображення останнього відомого статусу.');
  }
  async function toggleRefused() {
    try { await api.updateOrder(order.id, { isRefused: !order.isRefused }); onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <Modal isOpen title={`Замовлення від ${new Date(order.createdAt).toLocaleString('uk-UA')}`} onClose={onClose} wide>
      <ErrorBanner message={error} />
      <div className="space-y-5 text-sm">
        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Покупець</h4>
          <div>{order.buyer?.fullName || '—'} · {order.buyer?.phone}</div>
          {order.buyer?.igUsername && <a className="text-brand-light" href={`https://instagram.com/${order.buyer.igUsername}`} target="_blank" rel="noreferrer">@{order.buyer.igUsername}</a>}
          {order.buyer?.knownMeasurements && Object.keys(order.buyer.knownMeasurements).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(order.buyer.knownMeasurements).map(([k, v]) => (
                <Badge key={k}>{k}: {v}</Badge>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Товари</h4>
          <div className="space-y-1">
            {order.items.map((it) => (
              <div key={it.id} className="flex justify-between rounded-lg bg-slate-800/50 px-3 py-2">
                <span>
                  {it.name} × {it.quantity} {it.isUpsell && <Badge color="teal">Допродаж</Badge>}
                  {Array.isArray(it.properties) && it.properties.length > 0 && (
                    <span className="ml-2 text-xs text-slate-400">({it.properties.map((p) => `${p.name}: ${p.value}`).join(', ')})</span>
                  )}
                </span>
                <span>{money(Number(it.price) * it.quantity)}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Доставка</h4>
          <div className="text-slate-300">{order.shipping?.city || '—'}{order.shipping?.warehouse ? `, ${order.shipping.warehouse}` : ''}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {order.ttn?.length ? order.ttn.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-slate-500">ТТН немає</span>}
            {order.ttnStatus && <Badge color="green">{order.ttnStatus}</Badge>}
            <button onClick={refreshTtn} className="text-xs text-brand-light hover:underline">Оновити зараз</button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {order.isRefused ? <Badge color="red">Відмова від НП</Badge> : null}
            <button onClick={toggleRefused} className="text-xs text-slate-400 hover:text-red-300">
              {order.isRefused ? 'Зняти позначку відмови' : 'Позначити як відмову (не забрав/не оплатив на НП)'}
            </button>
          </div>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Оплата / коментар менеджера</h4>
          <Textarea rows={2} value={managerComment} onChange={(e) => setManagerComment(e.target.value)} onBlur={saveComment} />
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Атрибуція</h4>
          <div className="text-slate-400">
            Перший дотик: {order.firstTouchAd?.name || '— (органіка)'}<br />
            Останній дотик: {order.lastTouchAd?.name || '—'}
          </div>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Стадія</h4>
          <Select value={order.stageId || ''} onChange={(e) => changeStage(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </section>

        <div className="flex justify-between border-t border-slate-800 pt-4">
          <Button variant="secondary" onClick={() => onOpenReturn(order)}>Оформити повернення/обмін</Button>
          <Button variant="secondary" onClick={onClose}>Закрити</Button>
        </div>
      </div>
    </Modal>
  );
}
