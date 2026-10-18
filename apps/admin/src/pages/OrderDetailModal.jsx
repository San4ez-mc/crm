// §9.8 Замовлення — деталі (drawer/модалка з рядка списку).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Field, Input, Textarea, Select, Button, Badge, ErrorBanner, money, formatDateTime } from '../components/common/Common';
import Modal from '../components/common/Modal';
import OrderEditor from './OrderEditor';
import { PAYMENT_TYPE_LABEL } from '../components/orders/OrderFields';

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
    Promise.all(productIds.map((productId) => api.listAds({ productId, take: '30' }).then((r) => r.data || r || []).catch(() => [])))
      .then((lists) => {
        const seen = new Set();
        setSuggested(lists.flat().filter((a) => a.effectiveStatus === 'ACTIVE' && !a.variantOfAdId && !seen.has(a.id) && seen.add(a.id)));
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
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-slate-500">Реклама (атрибуція)</h4>
        <button onClick={() => { setOpen(!open); setQ(''); setFound([]); }} className="shrink-0 text-xs text-brand-light hover:underline">{open ? 'Скасувати' : (first || last) ? 'Змінити' : 'Вказати оголошення'}</button>
      </div>
      <div className="space-y-1.5 text-slate-300">
        {differ ? (
          <>
            <div><span className="text-slate-500">Перший дотик (йому зараховується замовлення): </span><AdLine ad={first} /></div>
            <div><span className="text-slate-500">Останній дотик: </span><AdLine ad={last} /></div>
          </>
        ) : (
          <div><span className="text-slate-500">Оголошення: </span><AdLine ad={first || last} /></div>
        )}
      </div>
      {open && (
        <div className="mt-2 rounded border border-slate-800 p-2">
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
    </section>
  );
}

// Оплата (2026-10-14, власник: «у картці замовлення має бути видно оплату»): платежі з журналу (бот, фонова перезвірка
// Flows) — GET /orders/:id віддає payments. Успішна = status 'success' або не вказано.
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
function PaymentSection({ order, payments }) {
  const total = (order.items || []).reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  const list = payments || [];
  const paid = list.filter((p) => !p.status || p.status === 'success').reduce((s, p) => s + Number(p.amount || 0), 0);
  const badge = paid <= 0
    ? <Badge color="red">не оплачено</Badge>
    : paid >= total && total > 0 ? <Badge color="green">оплачено повністю</Badge> : <Badge color="amber">передоплата</Badge>;
  return (
    <section>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase text-slate-500">Оплата</h4>
        {payments === null ? <span className="text-xs text-slate-500">завантаження…</span> : badge}
      </div>
      <PaymentTerms order={order} total={total} />
      {payments !== null && (
        <>
          <div className="mt-1 text-slate-200">Оплачено <b>{money(paid)}</b> з {money(total)}</div>
          {list.length > 0 ? (
            <div className="mt-1.5 space-y-1">
              {list.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-slate-800/50 px-3 py-1.5 text-xs">
                  <span className="text-slate-400">{formatDateTime(p.createdAt)}</span>
                  <span className="font-medium text-slate-200">{money(p.amount)}</span>
                  <span className="text-slate-400">{p.method || '—'}</span>
                  <Badge color={!p.status || p.status === 'success' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}>{PAY_STATUS_LABEL[p.status || 'success'] || p.status}</Badge>
                </div>
              ))}
            </div>
          ) : <div className="mt-1 text-xs text-slate-500">Платежів у журналі немає</div>}
        </>
      )}
    </section>
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

  return (
    <Modal isOpen title={`Замовлення від ${formatDateTime(order.createdAt)}`} onClose={onClose} wide>
      <ErrorBanner message={error} />
      {editing ? (
        <OrderEditor order={order} onCancel={() => setEditing(false)} onSaved={(o) => { setOrder(o); setEditing(false); onChanged(); }} />
      ) : (
      <div className="space-y-5 text-sm">
        <section>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase text-slate-500">Покупець</h4>
            <button onClick={() => setEditing(true)} className="text-xs text-brand-light hover:underline">✏️ Змінити дані клієнта</button>
          </div>
          {/* 2026-10-15 (Edit 2cb4dd27): поки клієнт не замовив (покупця ще нема) — імʼя й нікнейм з Instagram і розмова у Flows, а не «— ·». */}
          {order.buyer
            ? <div>{order.buyer.fullName || '—'}{order.buyer.phone ? ` · ${order.buyer.phone}` : ''}</div>
            : <div>{order.contactName || <span className="text-slate-500">ще не замовив</span>}</div>}
          <div className="flex flex-wrap items-center gap-x-3">
            {(order.buyer?.igUsername || order.contactIg) && <a className="text-brand-light" href={`https://instagram.com/${order.buyer?.igUsername || order.contactIg}`} target="_blank" rel="noreferrer">@{order.buyer?.igUsername || order.contactIg}</a>}
            {order.funnelSessionId && <a className="text-xs text-brand-light hover:underline" href={`https://flows.fineko.space/sessions/${order.funnelSessionId}`} target="_blank" rel="noreferrer">розмова у Flows ↗</a>}
          </div>
          {order.buyer?.knownMeasurements && Object.keys(order.buyer.knownMeasurements).length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(order.buyer.knownMeasurements).map(([k, v]) => (
                <Badge key={k}>{k}: {v}</Badge>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase text-slate-500">Товари</h4>
            <div className="flex items-center gap-2">
              {order.managerEditedAt && <Badge color="teal">Змінено менеджером {formatDateTime(order.managerEditedAt)}</Badge>}
              <button onClick={() => setEditing(true)} className="text-xs text-brand-light hover:underline">✏️ Редагувати замовлення</button>
            </div>
          </div>
          <div className="space-y-1">
            {order.items.map((it) => {
              // Фото конкретного варіанту (колір/розмір), якщо є — інакше загальне фото товару.
              const thumb = it.offer?.images?.[0] || it.product?.images?.[0] || it.product?.thumbnailUrl || '';
              return (
                <div key={it.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-800/50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    {thumb
                      ? <img src={thumb} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                      : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>}
                    <span>
                      {it.name} × {it.quantity} {it.isUpsell && <Badge color="teal">Допродаж</Badge>}
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
                  <span className="shrink-0">{money(Number(it.price) * it.quantity)}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Доставка</h4>
          <div className="text-slate-300">{order.shipping?.city || '—'}{(order.shipping?.branch || order.shipping?.warehouse) ? `, ${order.shipping.branch || order.shipping.warehouse}` : ''}</div>
          {(order.shipping?.recipientFullName || order.shipping?.recipientPhone) && (
            <div className="text-slate-400">Отримувач: {[order.shipping.recipientFullName, order.shipping.recipientPhone].filter(Boolean).join(' · ')}</div>
          )}
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

        <PaymentSection order={order} payments={payments} />

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Оплата / коментар менеджера</h4>
          <Textarea rows={2} value={managerComment} onChange={(e) => setManagerComment(e.target.value)} onBlur={saveComment} />
        </section>

        <AttributionSection order={order} onSaved={(o) => { setOrder({ ...order, ...o }); onChanged(); }} onError={setError} />

        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase text-slate-500">Стадія</h4>
          <Select value={order.stageId || ''} onChange={(e) => changeStage(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </section>

        <div className="flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => onOpenReturn(order)}>Оформити повернення/обмін</Button>
            {!isCancelled && <Button variant="secondary" onClick={cancelOrder}>Скасувати замовлення</Button>}
            {payments !== null && (deleteBlockers.length
              ? <span className="self-center text-xs text-slate-500" title="Видаляти можна лише помилково створені замовлення">Видалити не можна: {deleteBlockers.join(', ')}</span>
              : <button onClick={deleteOrder} className="px-2 text-sm text-red-400 hover:text-red-300">Видалити</button>)}
          </div>
          <Button variant="secondary" onClick={onClose}>Закрити</Button>
        </div>
      </div>
      )}
    </Modal>
  );
}
