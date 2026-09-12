// §9.7 Замовлення — основний робочий екран менеджера. Перемикач Дошка/Таблиця.
// 2026-09-05: прибрано фільтр "Усі стадії" (безкорисний — стадії й так усі видно колонками
// на дошці); додано вибір воронки (якщо їх декілька) — дошка показує стадії лише вибраної;
// зміна стадії — тільки через Select на картці/в таблиці (нативний HTML5 drag&drop на
// мобільних браузерах не працює й ще й глушив клік на відкриття картки).
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Input, Select, Card, EmptyState, ErrorBanner, Badge, money, formatDate } from '../components/common/Common';
import Modal from '../components/common/Modal';
import OrderDetailModal from './OrderDetailModal';
import NewOrderModal from './NewOrderModal';
import { ReturnForm } from './ReturnsPage';

export default function OrdersPage() {
  const [view, setView] = useState('board');
  // Верхній дублер горизонтального скролу дошки (2026-09-08): ширина береться з реальної ширини дошки.
  const boardRef = useRef(null);
  const topScrollRef = useRef(null);
  const [boardScrollWidth, setBoardScrollWidth] = useState(0);
  useEffect(() => {
    const el = boardRef.current; if (!el) return undefined;
    const upd = () => setBoardScrollWidth(el.scrollWidth);
    upd();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  });
  const [orders, setOrders] = useState(null);
  const [pipelines, setPipelines] = useState([]);
  const [pipelineId, setPipelineId] = useState('');
  const [ads, setAds] = useState([]);
  const [q, setQ] = useState('');
  const [adId, setAdId] = useState('');
  // 2026-09-12 (власник: "інакше тисячі карток") — фільтр по ДАТІ ПЕРШОГО КОНТАКТУ, за замовчуванням
  // завжди останні 7 днів від сьогодні (свіжий mount = свіже вікно, не застаріла дата).
  const _todayStr = () => new Date().toISOString().slice(0, 10);
  const _daysAgoStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const [ftFrom, setFtFrom] = useState(_daysAgoStr(7));
  const [ftTo, setFtTo] = useState(_todayStr());
  const [error, setError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [returnForOrder, setReturnForOrder] = useState(null);
  const [showNewOrder, setShowNewOrder] = useState(false);

  useEffect(() => { api.listAds().then((r) => setAds(r.data)).catch(() => {}); }, []);

  // 2026-09-07: посилання зі сповіщень Telegram — /orders?open=<orderId> одразу відкриває картку.
  useEffect(() => {
    const openId = new URLSearchParams(window.location.search).get('open');
    if (!openId) return;
    api.getOrder(openId).then((r) => { if (r.data) setSelectedOrder(r.data); }).catch((e) => setError('Замовлення ' + openId + ' не знайдено: ' + e.message));
  }, []);

  async function load() {
    setError('');
    try {
      const params = {};
      if (q) params.q = q;
      if (adId) params.adId = adId;
      if (ftFrom) params.ftFrom = ftFrom;
      if (ftTo) params.ftTo = ftTo;
      const [o, p] = await Promise.all([api.listOrders(params), api.listPipelines()]);
      setOrders(o.data);
      setPipelines(p.data);
      setPipelineId((prev) => (prev && p.data.some((pl) => pl.id === prev) ? prev : p.data[0]?.id || ''));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [q, adId, ftFrom, ftTo]);

  const currentPipeline = pipelines.find((p) => p.id === pipelineId);
  const stages = currentPipeline?.stages || [];

  // 2026-09-12 (живий баг, власник: стадія "Замовлення оформлене в постачальника" показувала 0,
  // хоча прямий запит підтвердив 43 реальних замовлення): `orders` вище — ЄДИНИЙ спільний top-100
  // за createdAt DESC на ВСІ стадії разом (для таблиці цього достатньо). Дошка ж фільтрує ЦЕЙ САМИЙ
  // масив по стадіях клієнтом — стадія, чиї замовлення "старіші" за 100 найновіших з ІНШИХ стадій
  // (типово для стадій, де замовлення довго не рухають — постачальник/повернення), просто НЕ
  // потрапляє у вибірку і виглядає порожньою, хоча насправді ні. Кожна колонка дошки тепер вантажить
  // СВІЙ власний топ-N окремим запитом (paralельно), незалежно від інших стадій.
  const [boardByStage, setBoardByStage] = useState({});
  async function loadBoard(stageList) {
    if (!stageList.length) return;
    try {
      const params = {};
      if (q) params.q = q;
      if (adId) params.adId = adId;
      if (ftFrom) params.ftFrom = ftFrom;
      if (ftTo) params.ftTo = ftTo;
      const results = await Promise.all(stageList.map((s) => api.listOrders({ ...params, stageId: s.id, take: 200 })));
      const next = {};
      stageList.forEach((s, i) => { next[s.id] = results[i].data; });
      setBoardByStage(next);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    if (view !== 'board') return;
    loadBoard(stages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pipelineId, q, adId, ftFrom, ftTo, stages.map((s) => s.id).join(',')]);

  async function moveOrderToStage(orderId, newStageId) {
    try { await api.updateOrder(orderId, { stageId: newStageId }); load(); loadBoard(stages); } catch (e) { alert(e.message); }
  }

  function orderTotal(order) {
    return order.items.reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  }

  return (
    <div>
      <PageHeader
        title="Замовлення"
        action={
          <div className="flex flex-wrap gap-2">
            {pipelines.length > 1 && (
              <Select className="!w-auto" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
            <Select className="!w-auto" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="board">Дошка</option>
              <option value="table">Таблиця</option>
            </Select>
            <Button onClick={() => setShowNewOrder(true)}>+ Замовлення</Button>
          </div>
        }
      />
      <ErrorBanner message={error} />

      {/* 2026-09-13 (власник: "поскладай красивіше ці поля") — раніше все в одному
          flex-wrap ряду з'їжджало хаотично на вузьких вікнах. Тепер два чіткі блоки:
          пошук/фільтр зліва, діапазон дати — окрема "пігулка" справа з власним фоном,
          щоб на wrap завжди падала ЦІЛА група, а не розривалась посередині. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-64" placeholder="Пошук за покупцем/телефоном/ТТН…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-56" value={adId} onChange={(e) => setAdId(e.target.value)}>
            <option value="">Усі оголошення</option>
            {ads.map((a) => <option key={a.id} value={a.id}>{a.name || a.externalId || a.id.slice(0, 8)}</option>)}
          </Select>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5">
          <span className="whitespace-nowrap text-xs font-medium text-slate-400">Перший контакт</span>
          <Input type="date" className="!w-auto" value={ftFrom} onChange={(e) => setFtFrom(e.target.value)} />
          <span className="text-slate-600">—</span>
          <Input type="date" className="!w-auto" value={ftTo} onChange={(e) => setFtTo(e.target.value)} />
          <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => { setFtFrom(_daysAgoStr(7)); setFtTo(_todayStr()); }}>Останні 7 днів</Button>
        </div>
      </div>

      {orders === null ? null : orders.length === 0 ? (
        <EmptyState title="Замовлень ще немає" hint="Вони приходять автоматично з воронки після оформлення клієнтом." />
      ) : view === 'board' ? (
        <>
        {/* 2026-09-08 (запит власника): горизонтальний скрол дошки і ЗВЕРХУ — дублер, синхронізований з основним. */}
        <div ref={topScrollRef} className="mb-1 overflow-x-auto" onScroll={(e) => { if (boardRef.current && boardRef.current.scrollLeft !== e.currentTarget.scrollLeft) boardRef.current.scrollLeft = e.currentTarget.scrollLeft; }}>
          <div style={{ width: boardScrollWidth, height: 1 }} />
        </div>
        <div ref={boardRef} className="flex gap-3 overflow-x-auto pb-2" onScroll={(e) => { if (topScrollRef.current && topScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft; }}>
          {stages.map((stage) => {
            const stageOrders = boardByStage[stage.id] || [];
            const stageSum = stageOrders.reduce((s, o) => s + orderTotal(o), 0);
            return (
              <div key={stage.id} className="w-72 shrink-0"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { const id = e.dataTransfer.getData('orderId'); if (id) moveOrderToStage(id, stage.id); }}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{stage.name}</span>
                  <span className="text-xs text-slate-500">{stageOrders.length}</span>
                </div>
                <div className="mb-2 px-1 text-xs font-medium text-brand-light">{money(stageSum)}</div>
                <div className="space-y-2">
                  {stageOrders.map((o) => (
                    <Card
                      key={o.id}
                      className="cursor-pointer p-3 hover:border-brand"
                      onClick={() => setSelectedOrder(o)}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('orderId', o.id)}
                    >
                      <div className="text-sm font-medium">{o.buyer?.fullName || o.buyer?.phone || o.contactName || (o.contactIg ? '@' + o.contactIg : 'Без покупця')}</div>
                      {(o.buyer?.igUsername || o.contactIg) && <div className="text-xs text-brand-light">@{o.buyer?.igUsername || o.contactIg}</div>}
                      <div className="mt-1 text-xs text-slate-500 line-clamp-1">{o.items.map((it) => it.name).join(', ')}</div>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-sm">{money(orderTotal(o))}</span>
                        {o.ttnStatus && <Badge color="green">{o.ttnStatus}</Badge>}
                      </div>
                      {o.firstTouchAd?.name && <div className="mt-1 truncate text-[11px] text-slate-500" title={o.firstTouchAd.name}>📢 {o.firstTouchAd.name}</div>}
                      <Select className="mt-2 w-full !py-1 text-xs" value={o.stageId || ''} onClick={(e) => e.stopPropagation()} onChange={(e) => moveOrderToStage(o.id, e.target.value)}>
                        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        </>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Покупець</th><th className="px-4 py-3">Товари</th><th className="px-4 py-3">Сума</th><th className="px-4 py-3">Стадія</th><th className="px-4 py-3">ТТН</th><th className="px-4 py-3">Джерело</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30" onClick={() => setSelectedOrder(o)}>
                  <td className="px-4 py-3 text-slate-400">{formatDate(o.createdAt)}</td>
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

      {showNewOrder && (
        <NewOrderModal
          stages={stages}
          ads={ads}
          onClose={() => setShowNewOrder(false)}
          onCreated={() => load()}
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
