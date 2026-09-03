// Детальна аналітика одного рекламного оголошення — drill-down з «Рекламні витрати».
// Структура за референсом власника (скрін з GPT): фото+статус, 2 ряди KPI, воронка
// оголошення (контакти→замовлення→забрано→відмови), графік результату по днях,
// що придбали клієнти, і таблиця самих замовлень. Уся маржа фактичного кошика
// зараховується цьому оголошенню (backend: computeAdStats у apps/api/src/routes/ads.js).
import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { PageHeader, Card, ErrorBanner, KpiCard, Badge, money } from '../components/common/Common';

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

function fmtDay(v) { return new Date(v).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }); }
const STATUS_LABEL = { picked_up: 'Забрано', refused: 'Відмова', returned: 'Повернення' };
const STATUS_COLOR = { picked_up: 'green', refused: 'red', returned: 'amber' };

// Воронка оголошення: контакти → замовлень → забрано → відмови, ширина стовпця
// пропорційна значенню — той самий "лійка звужується" вигляд, що на референсі.
function AdFunnel({ contacts, ordersCreated, ordersPickedUp, refusedCount }) {
  const stages = [
    { label: 'контакти', value: contacts, color: 'bg-sky-600' },
    { label: 'замовлень', value: ordersCreated, color: 'bg-sky-400' },
    { label: 'забрано', value: ordersPickedUp, color: 'bg-emerald-500' },
    { label: 'відмови', value: refusedCount, color: 'bg-red-500' },
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

// Комбо-графік по днях: стовпці Витрати(синій)/Маржа(зелений) + лінія Прибуток —
// самописний inline SVG (у застосунку нема сторонньої чарт-бібліотеки).
function ResultChart({ data }) {
  if (!data || data.length < 2) return <div className="py-8 text-center text-sm text-slate-500">Замало даних за період для графіка.</div>;
  const W = Math.max(560, data.length * 70);
  const H = 220;
  const padL = 44, padB = 24, padT = 10;
  const values = data.flatMap((d) => [d.spend, d.margin, d.profit]);
  const maxV = Math.max(1, ...values);
  const minV = Math.min(0, ...values);
  const scaleY = (v) => H - padB - ((v - minV) / (maxV - minV)) * (H - padB - padT);
  const slot = (W - padL) / data.length;
  const barW = Math.min(18, slot * 0.28);

  const linePoints = data.map((d, i) => `${padL + slot * i + slot / 2},${scaleY(d.profit)}`).join(' ');
  const zeroY = scaleY(0);

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H + 30} className="min-w-full">
        <line x1={padL} y1={zeroY} x2={W} y2={zeroY} stroke="#334155" strokeWidth="1" />
        {data.map((d, i) => {
          const x = padL + slot * i + slot / 2;
          return (
            <g key={d.date}>
              <rect x={x - barW - 2} y={Math.min(scaleY(d.spend), zeroY)} width={barW} height={Math.abs(scaleY(d.spend) - zeroY)} fill="#3b82f6" opacity="0.85" />
              <rect x={x + 2} y={Math.min(scaleY(d.margin), zeroY)} width={barW} height={Math.abs(scaleY(d.margin) - zeroY)} fill="#10b981" opacity="0.85" />
              <text x={x} y={H + 18} textAnchor="middle" fontSize="10" fill="#64748b">{fmtDay(d.date)}</text>
            </g>
          );
        })}
        <polyline points={linePoints} fill="none" stroke="#1d4ed8" strokeWidth="2" />
        {data.map((d, i) => (
          <circle key={d.date} cx={padL + slot * i + slot / 2} cy={scaleY(d.profit)} r="3.5" fill="#1d4ed8" />
        ))}
      </svg>
      <div className="flex gap-4 px-2 text-xs text-slate-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />Витрати</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Маржа</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-blue-700" />Прибуток</span>
      </div>
    </div>
  );
}

export default function AdSpendDetailPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api.getAdDetail(id, { ...(from ? { from } : {}), ...(to ? { to } : {}) }).then((r) => setData(r.data)).catch((e) => setError(e.message));
  }, [id, from, to]);

  if (!data) return <div><ErrorBanner message={error} /></div>;
  const { ad } = data;

  return (
    <div>
      <PageHeader
        title="Аналітика рекламного оголошення"
        action={<Link to="/ad-spend" className="text-sm text-brand-light hover:underline">← До списку</Link>}
      />
      <ErrorBanner message={error} />
      <div className="mb-4 text-xs text-slate-500">
        Період: {from || '—'} — {to || '—'} {ad.externalId && <span className="ml-3">Джерело замовлень: ad_id {ad.externalId}</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="p-4">
          {ad.thumbnailUrl
            ? <img src={ad.thumbnailUrl} alt="" className="mb-3 h-40 w-full rounded-lg object-cover" />
            : <div className="mb-3 flex h-40 w-full items-center justify-center rounded-lg bg-slate-800 text-slate-600">—</div>}
          <div className="font-medium">{ad.name || ad.externalId}</div>
          {ad.productName && <div className="mt-1 text-xs text-slate-500">Товар: {ad.productName}</div>}
          <div className="mt-2"><Badge color="green">Активне</Badge></div>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Витрати на рекламу" value={money(data.spend)} />
            <KpiCard label="Створені замовлення" value={data.ordersCreated} />
            <KpiCard label="Забрані замовлення" value={data.ordersPickedUp} />
            <KpiCard label="Фактична виручка" value={money(data.revenue)} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Маржа до реклами" value={money(data.margin)} />
            <HighlightCard label="Прибуток після реклами" value={money(data.profit)} good={data.profit >= 0} />
            <HighlightCard label="Окупність за маржею" value={data.roi !== null ? `×${data.roi.toFixed(2)}` : '—'} good={data.roi !== null && data.roi >= 1} />
            <HighlightCard label="ROMI" value={data.romi !== null ? `${data.romi.toFixed(1)}%` : '—'} good={data.romi !== null && data.romi >= 0} />
          </div>
        </div>
      </div>

      <Card className="mt-4 p-4">
        <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-4 lg:grid-cols-8">
          {[
            ['Нові контакти', data.contacts],
            ['Ціна контакту', data.costPerContact !== null ? money(data.costPerContact) : '—'],
            ['Ціна створеного замовлення', data.cpa !== null ? money(data.cpa) : '—'],
            ['Ціна забраного замовлення', data.cpaPickedUp !== null ? money(data.cpaPickedUp) : '—'],
            ['Конверсія в замовлення', data.conversionToOrder !== null ? `${data.conversionToOrder.toFixed(1)}%` : '—'],
            ['Відсоток забору', data.pickupRate !== null ? `${data.pickupRate.toFixed(1)}%` : '—'],
            ['Середній чек', data.avgCheck !== null ? money(data.avgCheck) : '—'],
            ['Середня маржа замовлення', data.avgMargin !== null ? money(data.avgMargin) : '—'],
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
          <AdFunnel contacts={data.contacts} ordersCreated={data.ordersCreated} ordersPickedUp={data.ordersPickedUp} refusedCount={data.refusedCount} />
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Результат за днями</h3>
          <ResultChart data={data.trend} />
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
            <tr><th className="px-4 py-3">Замовлення</th><th className="px-4 py-3">Фактичний кошик</th><th className="px-4 py-3">Статус</th><th className="px-4 py-3 text-right">Виручка</th><th className="px-4 py-3 text-right">Маржа</th></tr>
          </thead>
          <tbody>
            {data.orders.map((o) => (
              <tr key={o.id} className="border-b border-slate-800/60 last:border-0">
                <td className="px-4 py-3">#{o.id.slice(0, 6)}</td>
                <td className="px-4 py-3 text-slate-400">{o.itemsLabel}</td>
                <td className="px-4 py-3"><Badge color={STATUS_COLOR[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                <td className="px-4 py-3 text-right">{money(o.revenue)}</td>
                <td className="px-4 py-3 text-right">{money(o.margin)}</td>
              </tr>
            ))}
            {data.orders.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Замовлень ще немає.</td></tr>}
          </tbody>
        </table>
      </Card>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-xs text-slate-400">
        <span>ℹ️</span>
        <span>Уся маржа фактичного кошика (включно з допродажами чи іншими товарами) зараховується оголошенню, яке привело клієнта.</span>
      </div>
    </div>
  );
}
