// Тариф і оплата (2026-11-06): поточний план і дата закінчення, три тарифи, оплата через WayForPay, перевірка платежу після повернення.
// Із демо-магазину оплата створює НОВУ компанію оплатившому (потрібні email і назва магазину); з власного магазину — продовжує тариф.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { PageHeader, Card, Button, Input, Select, ErrorBanner, formatDateTime } from '../components/common/Common';
import { planInfo, fmtEnd, daysWord } from '../lib/plan';
import { toast } from '../components/common/Toast';

const CONTACT_URL = 'https://t.me/olexandrmatsuk'; // «Обговорити» для тарифу з AI-продавцем (онлайн-оплати в нього нема)

const PLAN_POINTS = {
  start: ['Усі замовлення на дошці з вашими етапами', 'Покупці без дублів, історія замовлень', 'Товари з кольорами, розмірами й комплектами', 'Статуси Нової пошти оновлюються самі', 'Прибуток по кожному замовленню', 'Повернення й обміни, Excel', '1 магазин, до 3 менеджерів'],
  plus: ['Усе зі «Старт»', 'Реклама Meta: яке оголошення приводить замовлення', 'Щоденна аналітика з прогнозом відмов', 'Звіт по менеджерах', 'Постачальники для дропшипінгу', 'До 3 магазинів, до 10 менеджерів'],
  ai: ['Усе з «Магазин+»', 'AI-продавець відповідає в Instagram Direct і створює замовлення в CRM', 'Налаштування під ваш магазин разом з нами', 'Підтримка, виправлення помилок і дрібні доопрацювання входять', 'Платите 75% від витрат на токени бота за місяць'],
};
const MONTH_LABEL = { 1: '1 місяць', 3: '3 місяці', 12: '12 місяців (2 в подарунок)' };

// Відправка форми на сторінку оплати WayForPay (масиви productName[] повторюються).
function submitToWayForPay({ url, fields }) {
  const form = document.createElement('form');
  form.method = 'POST'; form.action = url; form.acceptCharset = 'utf-8';
  for (const [name, value] of fields) {
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = name; input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function CurrentPlan({ tenant, status }) {
  const info = planInfo({ plan: status.plan, planEndsAt: status.endsAt });
  const tone = info.state === 'expired' ? 'border-red-800 bg-red-950/40' : info.state === 'soon' ? 'border-amber-700 bg-amber-950/40' : 'border-slate-800 bg-slate-900';
  return (
    <Card className={`mb-5 p-4 ${tone}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500">Поточний тариф · {tenant?.name}</div>
      {info.state === 'none' ? (
        <div className="mt-1 text-base">Тариф не вказано. Оберіть нижче.</div>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-xl font-semibold">{info.name}{status.isDemo ? ' · демо' : ''}</span>
          {info.state === 'unlimited' && <span className="text-sm text-slate-400">без дати закінчення</span>}
          {info.state === 'ok' && <span className="text-sm text-slate-300">оплачено до {fmtEnd(info.endsAt)} ({info.daysLeft} {daysWord(info.daysLeft)})</span>}
          {info.state === 'soon' && <span className="text-sm font-medium text-amber-200">лишилось {info.daysLeft} {daysWord(info.daysLeft)}, до {fmtEnd(info.endsAt)}</span>}
          {info.state === 'expired' && <span className="text-sm font-medium text-red-200">закінчився {fmtEnd(info.endsAt)}</span>}
        </div>
      )}
      {status.isDemo && <p className="mt-2 text-sm text-slate-400">Це демонстраційний магазин. Після оплати ми створимо для вас окрему компанію і надішлемо лист для входу.</p>}
    </Card>
  );
}

function PlanCard({ plan, status, onPay, busy }) {
  const [months, setMonths] = useState(1);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const billable = (status.monthOptions.find((m) => m.months === months) || {}).billableMonths || months;
  const usd = plan.priceUsd ? plan.priceUsd * billable : null;
  const needsOwner = status.isDemo;
  return (
    <Card className="flex flex-col p-4">
      <div className="text-lg font-semibold">{plan.name}</div>
      <div className="mt-1 text-2xl font-semibold text-brand-light">
        {plan.online ? <>${plan.priceUsd}<span className="text-sm font-normal text-slate-500"> / місяць</span></> : <span className="text-base">75% від токенів бота</span>}
      </div>
      <ul className="mt-3 flex-1 space-y-1.5 text-sm text-slate-300">
        {(PLAN_POINTS[plan.code] || []).map((p) => <li key={p} className="flex gap-2"><span className="text-emerald-400">✓</span><span>{p}</span></li>)}
      </ul>
      {plan.online ? (
        <div className="mt-4 space-y-2">
          <Select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {status.monthOptions.map((m) => <option key={m.months} value={m.months}>{MONTH_LABEL[m.months] || `${m.months} міс.`}</option>)}
          </Select>
          {needsOwner && (
            <>
              <Input placeholder="Назва вашого магазину" value={company} onChange={(e) => setCompany(e.target.value)} />
              <Input placeholder="Ваше імʼя" value={name} onChange={(e) => setName(e.target.value)} />
              <Input type="email" placeholder="Email для входу (сюди прийде лист)" value={email} onChange={(e) => setEmail(e.target.value)} />
            </>
          )}
          <Button className="w-full" disabled={busy || !status.canPayOnline} onClick={() => onPay({ plan: plan.code, months, email, name, companyName: company })}>
            {busy ? 'Відкриваю оплату…' : `Оплатити $${usd}`}
          </Button>
          {!status.canPayOnline && <p className="text-xs text-amber-300">Онлайн-оплата ще підключається. Напишіть нам, і ми виставимо рахунок вручну.</p>}
        </div>
      ) : (
        <a href={CONTACT_URL} target="_blank" rel="noreferrer" className="mt-4 block rounded-lg border border-brand px-4 py-2 text-center text-sm text-brand-light hover:bg-brand/10">Обговорити</a>
      )}
    </Card>
  );
}

export default function BillingPage() {
  const [params, setParams] = useSearchParams();
  const ref = params.get('ref');
  const { tenants, currentTenantId, fetchMe, setTenant } = useAuthStore();
  const tenant = tenants.find((t) => t.id === currentTenantId);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState(null); // результат перевірки платежу після повернення з оплати
  const tries = useRef(0);

  const load = () => api.billingStatus().then((r) => setStatus(r.data)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [currentTenantId]);

  // Повернулись з WayForPay (?ref=…): питаємо у CRM статус; поки «в обробці» — перевіряємо кожні 3 с до ~1,5 хв.
  useEffect(() => {
    if (!ref) return undefined;
    let stop = false; tries.current = 0;
    const tick = async () => {
      try {
        const r = await api.billingPayment(ref);
        if (stop) return;
        setPayment(r.data);
        if (r.data.status === 'pending' && tries.current++ < 30) setTimeout(tick, 3000);
        else if (r.data.status === 'paid') { load(); fetchMe(); toast.success('Оплату отримано. Дякуємо!'); }
      } catch (e) { if (!stop) setError(e.message); }
    };
    tick();
    return () => { stop = true; };
  }, [ref]);

  async function pay(body) {
    setError(''); setBusy(true);
    try {
      const r = await api.billingCheckout(body);
      submitToWayForPay(r.data);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  async function openNewCompany() {
    await fetchMe();
    const st = useAuthStore.getState();
    if (payment?.company && st.tenants.some((t) => t.id === payment.company.id)) { setTenant(payment.company.id); window.location.assign('/orders'); }
    else toast.info('Увійдіть із email, на який ми надіслали лист, щоб відкрити свою компанію.');
  }

  return (
    <div>
      <PageHeader title="Тариф і оплата" />
      <ErrorBanner message={error} />

      {ref && (
        <Card className="mb-5 p-4">
          {!payment && <div className="text-sm text-slate-400">Перевіряю оплату…</div>}
          {payment?.status === 'pending' && <div className="text-sm text-amber-200">Оплата ще обробляється. Сторінка оновиться сама, це займає до хвилини.</div>}
          {payment?.status === 'failed' && <div className="text-sm text-red-300">Оплата не пройшла ({payment.providerStatus || 'відхилено'}). Спробуйте ще раз іншою карткою.</div>}
          {payment?.status === 'paid' && !payment.applied && <div className="text-sm text-amber-200">Оплату отримано. Налаштовуємо доступ, оновіть сторінку за хвилину.</div>}
          {payment?.status === 'paid' && payment.applied && (
            payment.company ? (
              <div className="space-y-2">
                <div className="text-base font-semibold text-emerald-300">Оплата пройшла. Компанію «{payment.company.name}» створено.</div>
                <p className="text-sm text-slate-300">Ми надіслали лист для входу на {payment.invitedEmail}. Якщо листа немає, перевірте «Спам».</p>
                <Button onClick={openNewCompany}>Відкрити мою компанію</Button>
              </div>
            ) : <div className="text-base font-semibold text-emerald-300">Оплата пройшла. Тариф продовжено.</div>
          )}
          {payment && <button type="button" className="mt-2 text-xs text-slate-500 hover:text-slate-300" onClick={() => setParams({})}>Сховати</button>}
        </Card>
      )}

      {status && <CurrentPlan tenant={tenant} status={status} />}

      {status && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {status.plans.map((p) => <PlanCard key={p.code} plan={p} status={status} onPay={pay} busy={busy} />)}
        </div>
      )}

      {status && status.payments.length > 0 && (
        <Card className="mt-6 overflow-x-auto p-4">
          <h3 className="mb-2 text-sm font-semibold">Платежі</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Дата</th><th>Тариф</th><th>Період</th><th className="text-right">Сума</th><th>Статус</th></tr></thead>
            <tbody>
              {status.payments.map((p) => (
                <tr key={p.id} className="border-t border-slate-800">
                  <td className="py-1.5">{formatDateTime(p.createdAt)}</td>
                  <td>{p.plan}</td><td>{p.months} міс.</td>
                  <td className="text-right">{p.amount} {p.currency}</td>
                  <td>{p.status === 'paid' ? <span className="text-emerald-400">оплачено</span> : p.status === 'failed' ? <span className="text-red-400">не пройшла</span> : <span className="text-amber-300">очікує</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
