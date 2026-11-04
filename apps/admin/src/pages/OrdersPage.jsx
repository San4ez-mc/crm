// §9.7 Замовлення — основний робочий екран менеджера. Перемикач Дошка/Таблиця.
// 2026-09-05: прибрано фільтр "Усі стадії" (безкорисний — стадії й так усі видно колонками
// на дошці); додано вибір воронки (якщо їх декілька) — дошка показує стадії лише вибраної;
// зміна стадії — тільки через Select на картці/в таблиці (нативний HTML5 drag&drop на
// мобільних браузерах не працює й ще й глушив клік на відкриття картки).
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Input, Select, Card, EmptyState, ErrorBanner, Badge, money, formatDate } from '../components/common/Common';
import { DELIVERY, deliveryStatusOf } from '../components/orders/deliveryStatus';
import Modal from '../components/common/Modal';
import OrderDetailModal from './OrderDetailModal';
import NewOrderModal from './NewOrderModal';
import { ReturnForm } from './ReturnsPage';

const roundMoney = (v) => `${Math.round(Number(v) || 0).toLocaleString('uk-UA')} ₴`;

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
  // ?edit=1 у посиланні з Telegram («✏️ Редагувати замовлення») — картка відкривається одразу в режимі редагування.
  const [openInEdit, setOpenInEdit] = useState(() => new URLSearchParams(window.location.search).get('edit') === '1');
  const [returnForOrder, setReturnForOrder] = useState(null);
  const [showNewOrder, setShowNewOrder] = useState(false);

  useEffect(() => { api.listAds().then((r) => setAds(r.data)).catch(() => {}); }, []);

  // 2026-09-07: посилання зі сповіщень Telegram — /orders?open=<orderId> одразу відкриває картку.
  useEffect(() => {
    const openId = new URLSearchParams(window.location.search).get('open');
    if (!openId) return;
    api.getOrder(openId).then((r) => { if (r.data) setSelectedOrder(r.data); }).catch((e) => setError('Замовлення ' + openId + ' не знайдено: ' + e.message));
  }, []);

  // Фільтри сторінки — для списку, зведення зверху й Excel (одні й ті самі).
  function filterParams() {
    const params = {};
    if (q) params.q = q;
    if (adId === '__none') params.noAd = '1'; else if (adId) params.adId = adId;
    if (ftFrom) params.ftFrom = ftFrom;
    if (ftTo) params.ftTo = ftTo;
    return params;
  }

  // Зведення над списком: усього замовлень і сума за фільтрами + розбивка по стадіях (3.11, Олексій). Рахує сервер по всіх знайдених, не по перших 100.
  const [summary, setSummary] = useState(null);
  async function loadSummary() {
    try { setSummary((await api.ordersSummary(filterParams())).data); } catch (e) { /* зведення — додаток до списку, помилка не блокує роботу */ }
  }
  useEffect(() => { loadSummary(); }, [q, adId, ftFrom, ftTo]);

  const [exporting, setExporting] = useState(false);
  async function exportXlsx() {
    setExporting(true); setError('');
    try { await api.downloadOrdersXlsx(filterParams()); } catch (e) { setError('Не вдалось сформувати файл: ' + e.message); } finally { setExporting(false); }
  }

  async function load() {
    setError('');
    try {
      const params = {};
      if (q) params.q = q;
      if (adId === '__none') params.noAd = '1'; else if (adId) params.adId = adId;
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
      if (adId === '__none') params.noAd = '1'; else if (adId) params.adId = adId;
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

  // 31.10 (менеджери: «ТТН зникає після закриття картки»): дошка — вигляд за замовчуванням і вантажиться ОКРЕМО від таблиці. Картка
  // оновлювала лише таблицю (load), а дошка лишалась зі старими замовленнями — після збереження ТТН (і коментаря, дати, «Хто оформив»,
  // реклами) картка на дошці відкривалась зі старими даними, ніби нічого не збереглось. Тепер будь-яка зміна оновлює обидва списки.
  function refreshAll() { load(); loadSummary(); if (view === 'board') loadBoard(stages); } // у таблиці дошку не вантажимо — при поверненні на дошку її перезавантажує ефект [view]

  async function moveOrderToStage(orderId, newStageId) {
    try { await api.updateOrder(orderId, { stageId: newStageId }); refreshAll(); } catch (e) { alert(e.message); }
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
            {/* Перемикач вигляду іконками (3.11, Олексій): дошка — стовпці, таблиця — рядки. */}
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700" role="group" aria-label="Вигляд">
              {[
                { key: 'board', label: 'Дошка', icon: <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><rect x="2.5" y="3" width="4" height="14" rx="1" /><rect x="8" y="3" width="4" height="9" rx="1" /><rect x="13.5" y="3" width="4" height="11.5" rx="1" /></svg> },
                { key: 'table', label: 'Таблиця', icon: <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><rect x="2.5" y="3.5" width="15" height="13" rx="1.5" /><path d="M2.5 8h15M2.5 12.2h15M8 8v8.5" /></svg> },
              ].map((v) => (
                <button key={v.key} type="button" title={v.label} aria-label={v.label} aria-pressed={view === v.key} onClick={() => setView(v.key)}
                  className={`flex h-9 w-10 items-center justify-center transition-colors ${view === v.key ? 'bg-brand text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'}`}>
                  {v.icon}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={exportXlsx} disabled={exporting} title="Excel за обраними фільтрами (пошук, реклама, дата): аркуші «Замовлення» і «Позиції» — що саме замовили">
              <span className="inline-flex items-center gap-1.5">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v10m0 0l-3.5-3.5M10 13l3.5-3.5M3.5 16.5h13" /></svg>
                {exporting ? 'Формую…' : 'Excel'}
              </span>
            </Button>
            <Button onClick={() => setShowNewOrder(true)}>+ Замовлення</Button>
          </div>
        }
      />
      <ErrorBanner message={error} />

      {/* 2026-09-13 (власник: "поскладай красивіше ці поля") — раніше все в одному
          flex-wrap ряду з'їжджало хаотично на вузьких вікнах. Тепер два чіткі блоки:
          пошук/фільтр зліва, діапазон дати — окрема "пігулка" справа з власним фоном,
          щоб на wrap завжди падала ЦІЛА група, а не розривалась посередині. */}
      {/* 1.11 (власник, скріншот): Input має w-full за замовчуванням і перебивав w-64/w-56 — пошук і реклама розтягувались на весь рядок, а дата
          падала на третій. Тепер сітка: широкий — пошук | реклама | дата в один рядок; середній — пошук | реклама, дата під ними; вузький — стовпчик. */}
      <div className="mb-4 grid grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_15rem] xl:grid-cols-[minmax(0,1fr)_15rem_auto]">
        <Input placeholder="Пошук: імʼя, телефон, ТТН, Instagram (посилання або @нік)…" title="Можна вставити посилання на профіль Instagram — шукає за нікнеймом" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={adId} onChange={(e) => setAdId(e.target.value)}>
          <option value="">Усі оголошення</option>
          {/* Edits 15b533ae: замовлення, де не відомо, з якого оголошення написав клієнт — вказати вручну в картці. */}
          <option value="__none">Без реклами (вказати вручну)</option>
          {ads.map((a) => <option key={a.id} value={a.id}>{a.name || a.externalId || a.id.slice(0, 8)}</option>)}
        </Select>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 md:col-span-2 xl:col-span-1">
          <span className="whitespace-nowrap text-xs font-medium text-slate-400" title="Замовлення — за датою оформлення (її можна змінити в картці), розмови без замовлення — за датою розмови">Дата</span>
          <Input type="date" className="!w-auto" value={ftFrom} onChange={(e) => setFtFrom(e.target.value)} />
          <span className="text-slate-600">—</span>
          <Input type="date" className="!w-auto" value={ftTo} onChange={(e) => setFtTo(e.target.value)} />
          <Button variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => { setFtFrom(_daysAgoStr(7)); setFtTo(_todayStr()); }}>Останні 7 днів</Button>
        </div>
      </div>

      {/* Зведення за фільтрами (3.11, Олексій): один рядок дрібним шрифтом — «Оформлено» (є покупець) і по стадіях кількість · сума; порожні стадії не показуємо.
          Картки розмов без покупця входять у стадії, але не в «Оформлено». */}
      {summary && summary.total.count > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] leading-5 text-slate-400">
          <span className="rounded bg-brand/20 px-2 py-0.5 font-medium text-brand-light" title="Оформлені замовлення (є покупець) за обраними фільтрами">
            Оформлено: <b>{summary.total.placedCount}</b> · {roundMoney(summary.total.placedSum)}
          </span>
          {stages.map((s) => {
            const st = summary.stages.find((x) => x.stageId === s.id);
            if (!st || !st.count) return null;
            return (
              <span key={s.id} className="rounded bg-slate-800/70 px-1.5 py-0.5" title={`${s.name}: ${st.count} шт., ${roundMoney(st.sum)}`}>
                {s.name} <b className="text-slate-200">{st.count}</b> · {roundMoney(st.sum)}
              </span>
            );
          })}
          {summary.truncated && <span className="text-amber-300">(показано не всі — звузьте дати)</span>}
        </div>
      )}

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
                      {/* Менеджер видно у всіх стадіях (31.10, власник) — не лише оформлених. */}
                      {o.placedBy && <div className="mt-1 text-[11px] text-slate-400">👤 {o.placedBy}</div>}
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1">
                        <span className="text-sm">
                          {money(orderTotal(o))}
                          {o.paidSum > 0 && <span className={`ml-1.5 text-[11px] ${o.paidSum >= orderTotal(o) ? 'text-emerald-400' : 'text-amber-300'}`} title="Оплачено (журнал платежів)">💳 {money(o.paidSum)}</span>}
                        </span>
                        {o.ttnStatus && <Badge color={DELIVERY[deliveryStatusOf(o)].color}>{o.ttnStatus}</Badge>}
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
        <Card className="overflow-x-auto">
          {/* 3.11 (власник, скріншот): колонки мали однакову ширину — «Дата» і «Сума» марно широкі, «Товари» вузькі. Тепер фіксована розкладка:
              короткі колонки вузькі, «Товари» забирає весь залишок (до трьох рядків), стадія — повна ширина селекта. */}
          <table className="w-full min-w-[980px] table-fixed text-sm">
            <colgroup>
              <col style={{ width: '5.25rem' }} />
              <col style={{ width: '11rem' }} />
              <col />
              <col style={{ width: '6.5rem' }} />
              <col style={{ width: '13.5rem' }} />
              <col style={{ width: '10.5rem' }} />
              <col style={{ width: '10rem' }} />
            </colgroup>
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-3">Дата</th><th className="px-3 py-3">Покупець</th><th className="px-3 py-3">Товари</th><th className="px-3 py-3">Сума</th><th className="px-3 py-3">Стадія</th><th className="px-3 py-3">ТТН</th><th className="px-3 py-3">Джерело</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer border-b border-slate-800/60 align-top last:border-0 hover:bg-slate-800/30" onClick={() => setSelectedOrder(o)}>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-400">{formatDate(o.placedAt || o.createdAt)}</td>
                  <td className="px-3 py-3">
                    <div className="break-words">{o.buyer?.fullName || o.buyer?.phone || o.contactName || (o.contactIg ? '@' + o.contactIg : '—')}</div>
                    {o.placedBy && <div className="text-[11px] text-slate-500">👤 {o.placedBy}</div>}
                  </td>
                  <td className="px-3 py-3 text-slate-400"><div className="line-clamp-3 break-words" title={o.items.map((it) => it.name).join('\n')}>{o.items.map((it) => it.name).join(', ')}</div></td>
                  <td className="whitespace-nowrap px-3 py-3">
                    {money(orderTotal(o))}
                    {o.paidSum > 0 && <div className={`text-[11px] ${o.paidSum >= orderTotal(o) ? 'text-emerald-400' : 'text-amber-300'}`} title="Оплачено (журнал платежів)">💳 {money(o.paidSum)}</div>}
                  </td>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Select className="!w-full !py-1 text-xs" value={o.stageId || ''} onChange={(e) => moveOrderToStage(o.id, e.target.value)}>
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </td>
                  <td className="px-3 py-3 text-slate-400">
                    <div className="break-all text-xs">{o.ttn?.join(', ') || '—'}</div>
                    {o.ttnStatus && <div className="mt-1"><Badge color={DELIVERY[deliveryStatusOf(o)].color}>{o.ttnStatus}</Badge></div>}
                  </td>
                  <td className="px-3 py-3 text-slate-400"><div className="line-clamp-3 break-words text-xs" title={o.firstTouchAd?.name || o.sourceName || 'органіка'}>{o.firstTouchAd?.name || o.sourceName || 'органіка'}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selectedOrder && (
        <OrderDetailModal
          key={selectedOrder.id}
          order={selectedOrder}
          pipelines={pipelines}
          autoEdit={openInEdit}
          onClose={() => { setSelectedOrder(null); setOpenInEdit(false); }}
          onChanged={refreshAll}
          onOpenReturn={(o) => { setReturnForOrder(o); setSelectedOrder(null); }}
        />
      )}

      {showNewOrder && (
        <NewOrderModal
          stages={stages}
          ads={ads}
          onClose={() => setShowNewOrder(false)}
          onCreated={refreshAll}
        />
      )}

      <Modal isOpen={!!returnForOrder} title="Оформити повернення/обмін" onClose={() => setReturnForOrder(null)}>
        {returnForOrder && (
          <ReturnForm
            orderId={returnForOrder.id}
            onCancel={() => setReturnForOrder(null)}
            onSave={async (data) => { await api.createReturn(data); setReturnForOrder(null); refreshAll(); }}
          />
        )}
      </Modal>
    </div>
  );
}
