// Детальна аналітика одного рекламного оголошення — drill-down з «Рекламні витрати».
// Структура за референсом власника (скрін з GPT): фото+статус, 2 ряди KPI, воронка
// оголошення (контакти→замовлення→забрано→відмови), графік результату по днях,
// що придбали клієнти, і таблиця самих замовлень. Уся маржа фактичного кошика
// зараховується цьому оголошенню (backend: computeAdStats у apps/api/src/routes/ads.js).
// 2026-10-26 (Олексій, Edits ffcca141/537c402a/335a296f/47935e18/6194e8b9/11ab6f97): вибір періоду, «Окупність» на графіку й
// перемикачі показників, 4 блоки «з відмовами» (очікуваний % — налаштування магазину, за замовчуванням 23), % відмов у воронці,
// статуси посилок за Новою поштою, гривня/долар, ID оголошення з копіюванням.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHeader, Card, ErrorBanner, KpiCard, Badge, Input, formatDate, kyivDateStr } from '../components/common/Common';
import { useCurrency, fmtMoney, CurrencyToggle } from '../components/common/Currency';
import { DELIVERY } from '../components/orders/deliveryStatus';

// Проста KPI-картка з підсвіткою (зелена рамка, коли значення "хороше") — на відміну від
// KpiCard (для дельти vs попередній період), тут немає порівняння з іншим періодом, тож
// підсвічуємо просто за знаком/порогом самого значення (як зелені картки на референсі).
function HighlightCard({ label, value, good }) {
  return (
    <div className={`rounded-xl border p-4 ${good ? 'border-emerald-800 bg-emerald-900/10' : 'border-slate-800 bg-slate-900'}`}>
      <div className={`text-xs ${good ? 'text-emerald-400' : 'text-slate-500'}`}>{label}</div>
      <div className={`mt-1 text-xl font-semibold ${good ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}
// «З відмовами» (Edits 537c402a): мінус — червоним, плюс — зеленим.
function SignCard({ label, value, positive }) {
  return (
    <div className={`rounded-xl border p-4 ${positive ? 'border-emerald-800 bg-emerald-900/10' : 'border-red-900 bg-red-950/30'}`}>
      <div className={`text-xs ${positive ? 'text-emerald-400' : 'text-red-400'}`}>{label}</div>
      <div className={`mt-1 text-xl font-semibold ${positive ? 'text-emerald-300' : 'text-red-300'}`}>{value}</div>
    </div>
  );
}

// Воронка оголошення: контакти → замовлень → забрано → відмови, ширина стовпця
// пропорційна значенню — той самий "лійка звужується" вигляд, що на референсі.
function AdFunnel({ contacts, ordersCreated, ordersPickedUp, refusedCount, refusedRate }) {
  const stages = [
    { label: 'контакти', value: contacts, color: 'bg-sky-600' },
    { label: 'замовлень', value: ordersCreated, color: 'bg-sky-400' },
    { label: 'не відмовились', value: ordersPickedUp, color: 'bg-emerald-500' },
    { label: `відмови${refusedRate !== null && refusedRate !== undefined ? ` (${refusedRate.toFixed(0)}%)` : ''}`, value: refusedCount, color: 'bg-red-500' },
  ];
  const max = Math.max(1, contacts);
  return (
    <div className="space-y-1.5">
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-3">
          <div className={`flex h-10 items-center justify-center rounded-md text-sm font-semibold text-white ${s.color}`} style={{ width: `${Math.max(18, (s.value / max) * 100)}%` }}>
            {s.value}
          </div>
          <span className="text-xs text-slate-500">{s.label}</span>
        </div>
      ))}
    </div>
  );
}

const SERIES = [
  { key: 'spend', label: 'Витрати', color: '#3b82f6' },
  { key: 'margin', label: 'Маржа', color: '#10b981' },
  { key: 'profit', label: 'Прибуток', color: '#1d4ed8' },
  { key: 'roi', label: 'Окупність', color: '#f59e0b' },
];

// Комбо-графік по днях: стовпці Витрати/Маржа + лінії Прибуток і Окупність (×, окрема шкала праворуч) — самописний SVG.
// Кожен показник вмикається/вимикається кліком по ньому під графіком (Edits ffcca141).
function ResultChart({ data, on, toggle, toCur }) {
  const legend = (
    <div className="mt-2 flex flex-wrap gap-2 px-2 text-xs">
      {SERIES.map((s) => (
        <button key={s.key} type="button" onClick={() => toggle(s.key)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${on[s.key] ? 'border-slate-600 text-slate-200' : 'border-slate-800 text-slate-500 line-through'}`}>
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color, opacity: on[s.key] ? 1 : 0.3 }} />{s.label}
        </button>
      ))}
    </div>
  );
  if (!data || data.length < 2) return <div><div className="py-8 text-center text-sm text-slate-500">Замало даних за період для графіка.</div>{legend}</div>;
  const W = Math.max(560, data.length * 70);
  const H = 220;
  const padL = 52, padR = 40, padB = 24, padT = 10;
  const vals = data.flatMap((d) => [on.spend ? toCur(d.spend) : null, on.margin ? toCur(d.margin) : null, on.profit ? toCur(d.profit) : null]).filter((v) => v !== null);
  const maxV = Math.max(1, ...vals);
  const minV = Math.min(0, ...vals);
  const scaleY = (v) => H - padB - ((v - minV) / (maxV - minV)) * (H - padB - padT);
  const roiMax = Math.max(1, ...data.map((d) => d.roi || 0));
  const scaleR = (v) => H - padB - (v / roiMax) * (H - padB - padT);
  const slot = (W - padL - padR) / data.length;
  const barW = Math.min(18, slot * 0.28);
  const xOf = (i) => padL + slot * i + slot / 2;
  const zeroY = scaleY(0);
  const profitPts = data.map((d, i) => `${xOf(i)},${scaleY(toCur(d.profit))}`).join(' ');
  const roiPts = data.map((d, i) => (d.roi !== null && d.roi !== undefined ? `${xOf(i)},${scaleR(d.roi)}` : null)).filter(Boolean).join(' ');

  return (
    <div>
      <div className="overflow-x-auto">
        <svg width={W} height={H + 30} className="min-w-full">
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#334155" strokeWidth="1" />
          {on.roi && <text x={W - padR + 4} y={scaleR(1) + 3} fontSize="9" fill="#f59e0b">×1</text>}
          {on.roi && <line x1={padL} y1={scaleR(1)} x2={W - padR} y2={scaleR(1)} stroke="#f59e0b" strokeDasharray="3 4" strokeWidth="1" opacity="0.4" />}
          {data.map((d, i) => {
            const x = xOf(i);
            return (
              <g key={d.date}>
                {on.spend && <rect x={x - barW - 2} y={Math.min(scaleY(toCur(d.spend)), zeroY)} width={barW} height={Math.abs(scaleY(toCur(d.spend)) - zeroY)} fill="#3b82f6" opacity="0.85" />}
                {on.margin && <rect x={x + 2} y={Math.min(scaleY(toCur(d.margin)), zeroY)} width={barW} height={Math.abs(scaleY(toCur(d.margin)) - zeroY)} fill="#10b981" opacity="0.85" />}
                <text x={x} y={H + 18} textAnchor="middle" fontSize="10" fill="#64748b">{formatDate(d.date)}</text>
              </g>
            );
          })}
          {on.profit && <polyline points={profitPts} fill="none" stroke="#1d4ed8" strokeWidth="2" />}
          {on.profit && data.map((d, i) => <circle key={'p' + d.date} cx={xOf(i)} cy={scaleY(toCur(d.profit))} r="3.5" fill="#1d4ed8" />)}
          {on.roi && roiPts && <polyline points={roiPts} fill="none" stroke="#f59e0b" strokeWidth="2" />}
          {on.roi && data.map((d, i) => (d.roi !== null && d.roi !== undefined ? <circle key={'r' + d.date} cx={xOf(i)} cy={scaleR(d.roi)} r="3" fill="#f59e0b"><title>×{d.roi.toFixed(2)}</title></circle> : null))}
        </svg>
      </div>
      {legend}
    </div>
  );
}

function shiftDays(n) { const d = new Date(); d.setDate(d.getDate() - n); return kyivDateStr(d); }

export default function AdSpendDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const from = params.get('from') || shiftDays(7);
  const to = params.get('to') || kyivDateStr(new Date());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cur, setCur] = useCurrency();
  const [on, setOn] = useState({ spend: true, margin: true, profit: true, roi: true });
  const [pctEdit, setPctEdit] = useState(null);
  const [copied, setCopied] = useState(false);

  function load() {
    setError('');
    api.getAdDetail(id, { from, to }).then((r) => setData(r.data)).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [id, from, to]);
  const setPeriod = (f, t) => setParams({ from: f, to: t });
  async function savePct() {
    const v = String(pctEdit).trim();
    try { await api.updateTenantSettings({ expectedRefusalPct: v === '' ? null : Number(v) }); setPctEdit(null); load(); } catch (e) { setError(e.message); }
  }

  if (!data) return <div><ErrorBanner message={error} /></div>;
  const { ad } = data;
  const rate = data.usdRate;
  const m = (v) => fmtMoney(v, cur, rate);
  const toCur = (v) => (cur === 'USD' && Number(rate) > 0 ? Number(v || 0) / Number(rate) : Number(v || 0));
  const days = Math.round((new Date(to) - new Date(from)) / 86400000);

  return (
    <div>
      <PageHeader
        title="Аналітика рекламного оголошення"
        action={<div className="flex items-center gap-3"><CurrencyToggle cur={cur} setCur={setCur} usdRate={rate} /><Link to="/ad-spend" className="text-sm text-brand-light hover:underline">← До списку</Link></div>}
      />
      <ErrorBanner message={error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" className="!w-auto" value={from} onChange={(e) => setPeriod(e.target.value, to)} />
        <span className="text-slate-500">→</span>
        <Input type="date" className="!w-auto" value={to} onChange={(e) => setPeriod(from, e.target.value)} />
        {[7, 14, 30, 60, 90].map((n) => (
          <button key={n} type="button" onClick={() => setPeriod(shiftDays(n), kyivDateStr(new Date()))} className={`rounded-lg border px-3 py-1.5 text-xs ${days === n && to === kyivDateStr(new Date()) ? 'border-brand bg-brand/10 text-brand-light' : 'border-slate-700 bg-slate-800 hover:border-brand'}`}>{n} днів</button>
        ))}
        {ad.externalId && (
          <button type="button" className="ml-auto text-xs text-slate-500 hover:text-brand-light" title="Скопіювати ID оголошення (знайти в Ads Manager)"
            onClick={() => navigator.clipboard?.writeText(String(ad.externalId)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
            ID оголошення: {ad.externalId} {copied ? '✓ скопійовано' : '⧉'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="p-4">
          {ad.thumbnailUrl
            ? <img src={ad.thumbnailUrl} alt="" className="mb-3 h-40 w-full rounded-lg object-cover" />
            : <div className="mb-3 flex h-40 w-full items-center justify-center rounded-lg bg-slate-800 text-slate-600">—</div>}
          <div className="font-medium">{ad.name || ad.externalId}</div>
          {ad.productName && <div className="mt-1 text-xs text-slate-500">Товар: {ad.productName}</div>}
          {ad.postUrl && <a href={ad.postUrl} target="_blank" rel="noreferrer" className="mt-1 block text-xs text-brand-light hover:underline">відкрити пост ↗</a>}
          <div className="mt-2">{ad.effectiveStatus && ad.effectiveStatus !== 'ACTIVE' ? <Badge color="amber">На паузі</Badge> : <Badge color="green">Активне</Badge>}</div>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Витрати на рекламу" value={m(data.spend)} />
            <KpiCard label="Створені замовлення" value={data.ordersCreated} />
            <KpiCard label="Не відмовились" value={data.ordersPickedUp} />
            <KpiCard label="Фактична виручка" value={m(data.revenue)} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Маржа до реклами" value={m(data.margin)} />
            <HighlightCard label="Прибуток після реклами" value={m(data.profit)} good={data.profit >= 0} />
            <HighlightCard label="Окупність за маржею" value={data.roi !== null ? `×${data.roi.toFixed(2)}` : '—'} good={data.roi !== null && data.roi >= 1} />
            <HighlightCard label="ROMI" value={data.romi !== null ? `${data.romi.toFixed(1)}%` : '—'} good={data.romi !== null && data.romi >= 0} />
          </div>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span title="Посилки, які ще не забрали (очікує / в дорозі / на пошті), можуть повернутись: їхню маржу зменшено на очікуваний % відмов. Уже забрані — як є.">
                З урахуванням очікуваних відмов і повернень:
              </span>
              {pctEdit === null ? (
                <button type="button" onClick={() => setPctEdit(String(data.refusalPct))} className="text-brand-light hover:underline">{data.refusalPct}% (змінити)</button>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Input className="!w-16 !py-0.5 text-xs" value={pctEdit} onChange={(e) => setPctEdit(e.target.value)} />%
                  <button type="button" onClick={savePct} className="text-brand-light hover:underline">зберегти</button>
                  <button type="button" onClick={() => setPctEdit(null)} className="hover:underline">скасувати</button>
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SignCard label="Маржа до реклами з відмовами" value={m(data.marginExpected)} positive={data.marginExpected >= 0} />
              <SignCard label="Прибуток після реклами з відмовами" value={m(data.profitExpected)} positive={data.profitExpected >= 0} />
              <SignCard label="Окупність за маржею з відмовами" value={data.roiExpected !== null ? `×${data.roiExpected.toFixed(2)}` : '—'} positive={data.roiExpected === null || data.roiExpected >= 1} />
              <SignCard label="ROMI з відмовами" value={data.romiExpected !== null ? `${data.romiExpected.toFixed(1)}%` : '—'} positive={data.romiExpected === null || data.romiExpected >= 0} />
            </div>
          </div>
        </div>
      </div>

      <Card className="mt-4 p-4">
        <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4 lg:grid-cols-8">
          {[
            ['Нові контакти', data.contacts],
            ['Ціна контакту', data.costPerContact !== null ? m(data.costPerContact) : '—'],
            ['Ціна створеного замовлення', data.cpa !== null ? m(data.cpa) : '—'],
            ['Ціна замовлення без відмови', data.cpaPickedUp !== null ? m(data.cpaPickedUp) : '—'],
            ['Конверсія в замовлення', data.conversionToOrder !== null ? `${data.conversionToOrder.toFixed(1)}%` : '—'],
            ['Без відмов', data.pickupRate !== null ? `${data.pickupRate.toFixed(1)}%` : '—'],
            ['Середній чек', data.avgCheck !== null ? m(data.avgCheck) : '—'],
            ['Середня маржа замовлення', data.avgMargin !== null ? m(data.avgMargin) : '—'],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-xs text-slate-500">{label}</div>
              <div className="mt-1 text-lg font-semibold">{value}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr_260px]">
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Воронка оголошення</h3>
          <AdFunnel contacts={data.contacts} ordersCreated={data.ordersCreated} ordersPickedUp={data.ordersPickedUp} refusedCount={data.refusedCount} refusedRate={data.refusedRate} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Результат за днями</h3>
          <ResultChart data={data.trend} on={on} toggle={(k) => setOn((o) => ({ ...o, [k]: !o[k] }))} toCur={toCur} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Що придбали клієнти з цього оголошення</h3>
          {data.products.length === 0 ? <div className="text-sm text-slate-500">Ще немає продажів.</div> : (
            <div className="space-y-2">
              {data.products.map((p) => {
                const max = Math.max(1, ...data.products.map((x) => x.qty));
                return (
                  <div key={p.name}>
                    <div className="mb-0.5 flex justify-between text-xs"><span>{p.name}</span><span className="text-slate-400">{p.qty}</span></div>
                    <div className="h-2 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-brand" style={{ width: `${(p.qty / max) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <h3 className="p-4 pb-0 text-sm font-semibold">Замовлення, привʼязані до оголошення</h3>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
            <tr><th className="px-4 py-3">Дата</th><th className="px-4 py-3">Покупець</th><th className="px-4 py-3">Фактичний кошик</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3 text-right">Виручка</th><th className="px-4 py-3 text-right">Маржа</th></tr>
          </thead>
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-800/60 last:border-0">
                <td className="px-4 py-3 text-slate-400">{formatDate(o.createdAt)}</td>
                {/* 2026-10-14 (власник): імʼя й нікнейм Instagram замість id; клік — розмова у Flows, без розмови (оформив менеджер) — картка в CRM. */}
                <td className="px-4 py-3">{(() => {
                  const label = (<span>{o.buyerName || (o.igUsername ? '' : '#' + o.id.slice(0, 6))}{o.igUsername && <span className={o.buyerName ? 'ml-1.5 text-xs text-slate-400' : ''}>@{o.igUsername}</span>}</span>);
                  // Розмова є завжди: привʼязана — напряму; оформив менеджер — пошук у Flows за нікнеймом/телефоном (відкриває останню розмову).
                  const href = o.funnelSessionId ? `https://flows.fineko.space/sessions/${o.funnelSessionId}`
                    : o.flowsSearch ? `https://flows.fineko.space/sessions?search=${encodeURIComponent(o.flowsSearch)}&open=1` : null;
                  return href
                    ? <a className="text-brand-light hover:underline" href={href} target="_blank" rel="noreferrer" title="Відкрити розмову у Flows">{label} ↗</a>
                    : <a className="text-brand-light hover:underline" href={`/orders?open=${o.id}`} title="Ні нікнейму, ні телефону — відкрити замовлення в CRM">{label}</a>;
                })()}</td>
                <td className="px-4 py-3 text-slate-400">{o.itemsLabel}</td>
                <td className="px-4 py-3"><Badge color={(DELIVERY[o.status] || DELIVERY.awaiting).color}>{(DELIVERY[o.status] || DELIVERY.awaiting).label}</Badge></td>
                <td className="px-4 py-3 text-right">{m(o.revenue)}</td>
                <td className="px-4 py-3 text-right">{m(o.margin)}</td>
              </tr>
            ))}
            {data.orders.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Замовлень ще немає.</td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-400">
        <span>ℹ️</span>
        <span>Уся маржа фактичного кошика (включно з допродажами чи іншими товарами) зараховується оголошенню, яке привело клієнта. Дата замовлення — дата оформлення.</span>
      </div>
    </div>
  );
}
