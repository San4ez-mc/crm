// §9.8 Замовлення — деталі (drawer/модалка з рядка списку).
// 31.10 (власник: «поскладай картку зграбніше, щоб не було порожніх місць і не було переповнених»): розділи — однакові блоки у двох
// стовпцях (на вузьких екранах — в один), кожен рядок «підпис — значення» вирівняний; стадія й менеджер — угорі в «Оформленні».
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Input, Textarea, Select, Button, Badge, ErrorBanner, money, formatDateTime } from '../components/common/Common';
import Modal from '../components/common/Modal';
import OrderEditor from './OrderEditor';
import { PAYMENT_TYPE_LABEL } from '../components/orders/OrderFields';
import { DELIVERY, deliveryStatusOf } from '../components/orders/deliveryStatus';

// Блок картки: однаковий вигляд усіх розділів (заголовок + дія праворуч). h-full — блоки в одному ряду сітки однакової висоти.
function Block({ title, action, children, className = '' }) {
  return (
    <section className={`h-full rounded-xl border border-slate-800 bg-slate-900/40 p-4 ${className}`}>
      <div className="mb-3 flex min-h-[1.25rem] items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

// Рядок «підпис — значення»: підпис фіксованої ширини зліва, значення в другій колонці (на вузькому екрані — два рядки).
function Row({ label, children }) {
  return (
    <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <span className="text-xs text-slate-500">{label}</span>
      <div className="min-w-0 text-slate-200">{children}</div>
    </div>
  );
}

// Реклама замовлення (Edits 3605aed1/2f4d68fd, 2026-10-06): видно для будь-якого замовлення (і створеного ботом), можна змінити вручну.
// Перший дотик — реклама, з якої людина вперше прийшла в розмову (саме їй звіти зараховують замовлення); останній — остання реклама
// перед замовленням. Бот ставить обидва автоматично з розмови (лише за справжнім id реклами від Meta — не вгадує).
// 2026-10-15 (Edits a54a9497/dfea1e28, Олексій: «не потрібно двічі обирати оголошення»): одна кнопка — вибране оголошення ставиться
// і першим, і останнім дотиком. Два рядки показуємо, лише коли бот бачив дві різні реклами. Підказки — активні оголошення товарів
// замовлення (коли Meta не передала, з якої реклами клієнт, — вибрати в один клік), біля кожного — посилання на сам пост, бо в
// Олексія кілька оголошень з однаковою назвою (Edits 9ad83120/09ba3c2c).
function AdLine({ ad }) {
  if (!ad) return <span className="text-slate-500">— не вказано (органіка або Meta не передала рекламу)</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {ad.thumbnailUrl && <img src={ad.thumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />}
      <span>{ad.name || ad.externalId}{ad.campaignName && ad.campaignName !== ad.name ? <span className="text-slate-500"> · {ad.campaignName}</span> : null}</span>
      {ad.effectiveStatus && ad.effectiveStatus !== 'ACTIVE' && <Badge color="amber">на паузі</Badge>}
      {ad.postUrl && <a href={ad.postUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-brand-light hover:underline">пост ↗</a>}
    </span>
  );
}

function AttributionSection({ order, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [suggested, setSuggested] = useState(null);
  const productIds = [...new Set((order.items || []).filter((it) => !it.isUpsell).map((it) => it.productId || it.product?.id).filter(Boolean))];
  useEffect(() => {
    if (!open || suggested !== null) return;
    // Оголошення товару, що реально крутились (є витрати) від тижня до замовлення до сьогодні — не «30 найновіших за запуском» (Edits f609591e).
    const days = Math.min(60, 7 + Math.ceil((Date.now() - new Date(order.placedAt || order.createdAt).getTime()) / 86400000));
    Promise.all(productIds.map((productId) => api.listAds({ productId, running: String(days), take: '60' }).then((r) => r.data || r || []).catch(() => [])))
      .then((lists) => {
        const seen = new Set();
        setSuggested(lists.flat().filter((a) => !a.variantOfAdId && !seen.has(a.id) && seen.add(a.id)));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  async function search(text) {
    setQ(text);
    if (text.trim().length < 2) { setFound([]); return; }
    try { const r = await api.listAds({ search: text.trim(), status: 'all', take: '20' }); setFound((r.data || r || []).filter((a) => !a.variantOfAdId)); } catch (e) { onError(e.message); }
  }
  async function choose(ad) {
    try {
      const adId = ad ? ad.id : null;
      const r = await api.setOrderAttribution(order.id, { firstTouchAdId: adId, lastTouchAdId: adId });
      onSaved({ ...(r.data || {}), firstTouchAd: ad, lastTouchAd: ad });
      setOpen(false); setQ(''); setFound([]);
    } catch (e) { onError(e.message); }
  }
  const first = order.firstTouchAd || null;
  const last = order.lastTouchAd || null;
  const differ = first && last && first.id !== last.id;
  const pick = (a) => (
    <button key={a.id} onClick={() => choose(a)} className="block w-full rounded px-2 py-1 text-left hover:bg-slate-800">
      <AdLine ad={a} />
    </button>
  );
  return (
    <Block
      title="Реклама"
      action={<button onClick={() => { setOpen(!open); setQ(''); setFound([]); }} className="shrink-0 text-xs text-brand-light hover:underline">{open ? 'Скасувати' : (first || last) ? 'Змінити' : 'Вказати оголошення'}</button>}
    >
      <div className="space-y-1.5 text-slate-300">
        {differ ? (
          <>
            <div><span className="text-slate-500">Перший дотик (йому зараховується замовлення): </span><AdLine ad={first} /></div>
            <div><span className="text-slate-500">Останній дотик: </span><AdLine ad={last} /></div>
          </>
        ) : (
          // Замовлення не з реклами, але джерело відоме (лендінг, ручне) — показуємо його замість «не вказано».
          <div>{!(first || last) && order.sourceName ? <span>{order.sourceName}</span> : <AdLine ad={first || last} />}</div>
        )}
      </div>
      {open && (
        <div className="mt-3 rounded-lg border border-slate-800 p-2">
          {productIds.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[11px] uppercase text-slate-500">Активні оголошення товарів цього замовлення</div>
              {suggested === null ? <div className="px-2 text-xs text-slate-500">завантаження…</div>
                : suggested.length ? <div className="max-h-56 space-y-1 overflow-y-auto">{suggested.map(pick)}</div>
                : <div className="px-2 text-xs text-slate-500">активних оголошень для цих товарів немає — знайдіть нижче</div>}
            </div>
          )}
          <Input placeholder="Або знайдіть: назва оголошення, кампанії або Meta-id…" value={q} onChange={(e) => search(e.target.value)} />
          <div className="mt-1 max-h-56 space-y-1 overflow-y-auto">
            {found.map(pick)}
            <button onClick={() => choose(null)} className="block w-full rounded px-2 py-1 text-left text-slate-500 hover:bg-slate-800">— прибрати (органіка)</button>
          </div>
        </div>
      )}
    </Block>
  );
}

// Оформлення: стадія, «Хто оформив» і дата. Дата оформлення й «Хто оформив» (2026-10-26, Edits c4fc2dcd/15b533ae): від дати оформлення
// рахують звіти й фільтр дошки; правки її не змінюють. «Змінити дату» — менеджер прийняв у пʼятницю ввечері, а оформив у понеділок.
// 31.10 (власник): менеджер — у ВСІХ статусах (і в картці розмови до замовлення), одразу випадаючим списком усіх, хто має доступ до CRM
// магазину (SSO); зберігається при виборі, без окремої кнопки «Змінити» (за цим полем Олексій рахує зарплату).
const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
function OrderMeta({ order, stages, onChangeStage, onSaved, onError }) {
  const placed = !!(order.buyer || order.placedAt);
  const [editDate, setEditDate] = useState(false);
  const [date, setDate] = useState(toLocalInput(order.placedAt || order.createdAt));
  const [managers, setManagers] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api.getStaff().then((r) => setManagers((r.data || []).map((u) => u.name))).catch(() => setManagers([]));
  }, []);
  // «Бот» — завжди; поточне значення, якого нема в списку (стара вільна назва), лишається вибраним, а не губиться.
  const whoOptions = [...new Set([...(managers || []), 'Бот', ...(order.placedBy ? [order.placedBy] : [])])];
  async function save(patch) {
    setSaving(true);
    try { const r = await api.updateOrder(order.id, patch); onSaved(r.data || patch); setEditDate(false); } catch (e) { onError(e.message); }
    finally { setSaving(false); }
  }
  return (
    <Block title="Оформлення">
      <div className="divide-y divide-slate-800/60">
        <Row label="Стадія">
          <Select className="!py-1.5" value={order.stageId || ''} onChange={(e) => onChangeStage(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Row>
        <Row label={placed ? 'Хто оформив' : 'Менеджер'}>
          <Select className="!py-1.5" value={order.placedBy || ''} onChange={(e) => save({ placedBy: e.target.value || null })} disabled={managers === null || saving}>
            <option value="">{managers === null ? 'Завантаження…' : '— не вказано —'}</option>
            {whoOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Row>
        <Row label={placed ? 'Дата оформлення' : 'Розмова від'}>
          {placed && editDate ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input type="datetime-local" className="!w-auto !py-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
              <button onClick={() => save({ placedAt: new Date(date).toISOString() })} className="text-xs text-brand-light hover:underline">Зберегти</button>
              <button onClick={() => setEditDate(false)} className="text-xs text-slate-500 hover:underline">Скасувати</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{formatDateTime(order.placedAt || order.createdAt)}</span>
              {placed && <button onClick={() => setEditDate(true)} className="text-xs text-brand-light hover:underline">Змінити дату</button>}
            </div>
          )}
        </Row>
      </div>
    </Block>
  );
}

const PAY_STATUS_LABEL = { success: 'успішно', pending: 'очікує', failed: 'не пройшла' };
// 2026-10-18: спосіб оплати, про який домовились із клієнтом (Order.paymentType/prepaymentAmount), — окремо від журналу.
function PaymentTerms({ order, total }) {
  if (!order.paymentType) return <div className="text-xs text-slate-500">Спосіб оплати не вказано — оберіть у «✏️ Редагувати замовлення»</div>;
  const prepay = order.paymentType === 'cod' ? 0 : order.paymentType === 'full' ? total : Number(order.prepaymentAmount || 0);
  return (
    <div className="text-slate-200">
      <b>{PAYMENT_TYPE_LABEL[order.paymentType] || order.paymentType}</b>
      {order.paymentType !== 'cod' && <> · передплата {money(prepay)}</>}
      {' · '}решта при отриманні <b>{money(Math.max(0, total - prepay))}</b>
    </div>
  );
}
// Оплата (2026-10-14, власник: «у картці замовлення має бути видно оплату»): платежі з журналу (бот, фонова перезвірка
// Flows) — GET /orders/:id віддає payments. Успішна = status 'success' або не вказано.
function PaymentSection({ order, payments }) {
  const total = (order.items || []).reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  const list = payments || [];
  const paid = list.filter((p) => !p.status || p.status === 'success').reduce((s, p) => s + Number(p.amount || 0), 0);
  const badge = paid <= 0
    ? <Badge color="red">не оплачено</Badge>
    : paid >= total && total > 0 ? <Badge color="green">оплачено повністю</Badge> : <Badge color="amber">передоплата</Badge>;
  return (
    <Block title="Оплата" action={payments === null ? <span className="text-xs text-slate-500">завантаження…</span> : badge}>
      <PaymentTerms order={order} total={total} />
      {payments !== null && (
        <>
          <div className="mt-1.5 text-slate-200">Оплачено <b>{money(paid)}</b> з {money(total)}</div>
          {list.length > 0 ? (
            <div className="mt-2 space-y-1">
              {list.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-slate-800/50 px-3 py-1.5 text-xs">
                  <span className="text-slate-400">{formatDateTime(p.createdAt)}</span>
                  <span className="font-medium text-slate-200">{money(p.amount)}</span>
                  <span className="text-slate-400">{p.method || '—'}</span>
                  <Badge color={!p.status || p.status === 'success' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}>{PAY_STATUS_LABEL[p.status || 'success'] || p.status}</Badge>
                </div>
              ))}
            </div>
          ) : <div className="mt-1.5 text-xs text-slate-500">Платежів у журналі немає</div>}
        </>
      )}
    </Block>
  );
}

export default function OrderDetailModal({ order: initialOrder, pipelines, onClose, onChanged, onOpenReturn, autoEdit = false }) {
  // Після збереження правок картка показує свіже замовлення (список оновлюється окремо через onChanged).
  const [order, setOrder] = useState(initialOrder);
  const [editing, setEditing] = useState(autoEdit);
  const [managerComment, setManagerComment] = useState(order.managerComment || '');
  const [error, setError] = useState('');
  const stages = pipelines?.flatMap((p) => p.stages) || [];
  // Платежі — окремим запитом картки (список замовлень їх не містить, лише paidSum).
  const [payments, setPayments] = useState(null);
  useEffect(() => {
    api.getOrder(initialOrder.id).then((r) => setPayments(r.data?.payments || [])).catch(() => setPayments([]));
  }, [initialOrder.id]);

  // Після зміни на сервері картка одразу показує нове значення (раніше стадія/відмова/статус НП після збереження лишались старими
  // до повторного відкриття) — зливаємо відповідь API в локальний стан і оновлюємо списки.
  const merge = (data) => setOrder((o) => ({ ...o, ...(data || {}) }));
  async function saveComment() {
    try { await api.updateOrder(order.id, { managerComment }); onChanged(); } catch (e) { setError(e.message); }
  }
  async function changeStage(stageId) {
    try { const r = await api.updateOrder(order.id, { stageId }); merge(r.data); onChanged(); } catch (e) { setError(e.message); }
  }
  async function refreshTtn() {
    try {
      const r = await api.refreshOrderTtn(order.id);
      if (r?.data?.skipped) setError(r.data.skipped);
      const fresh = await api.getOrder(order.id);
      merge(fresh.data); setPayments(fresh.data?.payments || []);
      onChanged();
    } catch (e) { setError(e.message); }
  }
  async function toggleRefused() {
    try { const r = await api.updateOrder(order.id, { isRefused: !order.isRefused }); merge(r.data); onChanged(); } catch (e) { setError(e.message); }
  }
  // 2026-10-18 (Олексій: «видалити/скасувати»): скасування — стадія «Скасовано», замовлення лишається в історії й аналітиці;
  // видалення — лише помилково створене замовлення без платежів, ТТН і повернень (сервер перевіряє те саме).
  async function cancelOrder() {
    if (!confirm('Скасувати замовлення? Воно перейде в стадію «Скасовано» і лишиться в історії.')) return;
    try { const r = await api.cancelOrder(order.id); setOrder({ ...order, ...r.data }); onChanged(); } catch (e) { setError(e.message); }
  }
  const deleteBlockers = [
    payments && payments.length ? 'є платежі' : '',
    order.ttn?.length ? 'є ТТН' : '',
    order.returns?.length ? 'є повернення' : '',
  ].filter(Boolean);
  async function deleteOrder() {
    if (!confirm('Видалити замовлення назавжди? Це для замовлень, створених помилково, — відновити не вийде.')) return;
    try { await api.deleteOrder(order.id); onChanged(); onClose(); } catch (e) { setError(e.message); }
  }
  const currentStage = stages.find((s) => s.id === order.stageId);
  const isCancelled = /скасов|cancel/i.test(currentStage?.name || '');
  const itemsTotal = (order.items || []).reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  const igName = order.buyer?.igUsername || order.contactIg;
  const measurements = order.buyer?.knownMeasurements && Object.keys(order.buyer.knownMeasurements).length ? Object.entries(order.buyer.knownMeasurements) : [];

  return (
    <Modal isOpen title={order.buyer || order.placedAt ? `Замовлення від ${formatDateTime(order.placedAt || order.createdAt)}` : `Розмова від ${formatDateTime(order.createdAt)}`} onClose={onClose} wide="xl">
      <ErrorBanner message={error} />
      {editing ? (
        <OrderEditor order={order} onCancel={() => setEditing(false)} onSaved={(o) => { setOrder(o); setEditing(false); onChanged(); }} />
      ) : (
      <div className="space-y-4 text-sm">
        {/* Хто купує | стадія, менеджер, дата */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Block
            title="Покупець"
            /* Одна кнопка (Edits 15b533ae): редактор міняє і клієнта, і товари, і доставку, і оплату. */
            action={<button onClick={() => setEditing(true)} className="text-xs text-brand-light hover:underline">✏️ Редагувати замовлення</button>}
          >
            {/* 2026-10-15 (Edit 2cb4dd27): поки клієнт не замовив (покупця ще нема) — імʼя й нікнейм з Instagram і розмова у Flows, а не «— ·». */}
            <div className="text-base font-medium text-slate-100">
              {order.buyer
                ? <>{order.buyer.fullName || '—'}{order.buyer.phone ? <span className="font-normal text-slate-300"> · {order.buyer.phone}</span> : null}</>
                : (order.contactName || <span className="font-normal text-slate-500">ще не замовив</span>)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {igName && <a className="text-brand-light hover:underline" href={`https://instagram.com/${igName}`} target="_blank" rel="noreferrer">@{igName}</a>}
              {order.funnelSessionId && <a className="text-xs text-brand-light hover:underline" href={`https://flows.fineko.space/sessions/${order.funnelSessionId}`} target="_blank" rel="noreferrer">розмова у Flows ↗</a>}
            </div>
            {measurements.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {measurements.map(([k, v]) => <Badge key={k}>{k}: {v}</Badge>)}
              </div>
            )}
          </Block>
          <OrderMeta order={order} stages={stages} onChangeStage={changeStage} onSaved={(o) => { merge(o); onChanged(); }} onError={setError} />
        </div>

        {/* Що замовлено */}
        <Block title="Товари" action={order.managerEditedAt ? <Badge color="teal">Змінено менеджером {formatDateTime(order.managerEditedAt)}</Badge> : null}>
          <div className="space-y-1.5">
            {order.items.map((it) => {
              // Фото конкретного варіанту (колір/розмір), якщо є — інакше загальне фото товару.
              const thumb = it.offer?.images?.[0] || it.product?.images?.[0] || it.product?.thumbnailUrl || '';
              return (
                <div key={it.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-3">
                    {thumb
                      ? <img src={thumb} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                      : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>}
                    <span className="min-w-0">
                      <span className="text-slate-100">{it.name} × {it.quantity}</span> {it.isUpsell && <Badge color="teal">Допродаж</Badge>}
                      {Array.isArray(it.properties) && it.properties.length > 0 && (
                        <span className="ml-2 text-xs text-slate-400">({it.properties.map((p) => `${p.name}: ${p.value}`).join(', ')})</span>
                      )}
                      {it.supplier?.name && <span className="mt-0.5 block text-xs text-slate-500">Постачальник: {it.supplier.name}</span>}
                      {Array.isArray(it.components) && it.components.length > 0 && (
                        <span className="mt-0.5 block text-xs text-slate-400">
                          {it.components.map((c) => [c.name, c.color, c.size, c.qty > 1 ? `×${c.qty}` : ''].filter(Boolean).join(' · ')).join('; ')}
                        </span>
                      )}
                    </span>
                  </div>
                  <span className="shrink-0 font-medium text-slate-100">{money(Number(it.price) * it.quantity)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-800/60 pt-3">
            <span className="text-xs uppercase tracking-wide text-slate-500">Разом</span>
            <span className="text-base font-semibold text-slate-100">{money(itemsTotal)}</span>
          </div>
        </Block>

        {/* Доставка | оплата */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Block title="Доставка" action={order.ttn?.length ? <button onClick={refreshTtn} className="text-xs text-brand-light hover:underline">Оновити статус НП</button> : null}>
            <div className="divide-y divide-slate-800/60">
              <Row label="Адреса">
                {order.shipping?.city || order.shipping?.branch || order.shipping?.warehouse
                  ? `${order.shipping?.city || '—'}${(order.shipping?.branch || order.shipping?.warehouse) ? `, ${order.shipping.branch || order.shipping.warehouse}` : ''}`
                  : <span className="text-slate-500">не вказана</span>}
              </Row>
              {(order.shipping?.recipientFullName || order.shipping?.recipientPhone) && (
                <Row label="Отримувач">{[order.shipping.recipientFullName, order.shipping.recipientPhone].filter(Boolean).join(' · ')}</Row>
              )}
              <Row label="ТТН">
                {order.ttn?.length
                  ? <div className="flex flex-wrap gap-1.5">{order.ttn.map((t) => <Badge key={t}>{t}</Badge>)}</div>
                  : <span className="text-slate-500">ще немає</span>}
              </Row>
              {order.ttn?.length > 0 && (
                <Row label="Статус НП">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {order.ttnStatus ? <Badge color={DELIVERY[deliveryStatusOf(order)].color}>{order.ttnStatus}</Badge> : <span className="text-slate-500">ще не перевірено</span>}
                    {order.ttnEta && <span className="text-xs text-slate-400">доставка: {new Date(order.ttnEta).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</span>}
                    {order.ttnStatusAt && <span className="text-xs text-slate-500">перевірено {new Date(order.ttnStatusAt).toLocaleString('uk-UA', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>
                </Row>
              )}
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-slate-800/60 pt-3 text-xs text-slate-400">
              <input type="checkbox" checked={!!order.isRefused} onChange={toggleRefused} />
              <span className={order.isRefused ? 'text-red-300' : ''}>Відмова на НП (не забрав / не оплатив)</span>
            </label>
          </Block>
          <PaymentSection order={order} payments={payments} />
        </div>

        {/* Реклама | коментар */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AttributionSection order={order} onSaved={(o) => { merge(o); onChanged(); }} onError={setError} />
          <Block title="Коментар менеджера">
            <Textarea rows={3} placeholder="Нотатки для команди: домовленості з клієнтом, нюанси оплати чи доставки…" value={managerComment} onChange={(e) => setManagerComment(e.target.value)} onBlur={saveComment} />
          </Block>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => onOpenReturn(order)}>Оформити повернення/обмін</Button>
            {!isCancelled && <Button variant="secondary" onClick={cancelOrder}>Скасувати замовлення</Button>}
            {payments !== null && (deleteBlockers.length
              ? <span className="text-xs text-slate-500" title="Видаляти можна лише помилково створені замовлення">Видалити не можна: {deleteBlockers.join(', ')}</span>
              : <button onClick={deleteOrder} className="px-2 text-sm text-red-400 hover:text-red-300">Видалити</button>)}
          </div>
          <Button variant="secondary" onClick={onClose}>Закрити</Button>
        </div>
      </div>
      )}
    </Modal>
  );
}
