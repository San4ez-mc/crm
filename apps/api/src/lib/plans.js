// Тарифи Fineko CRM (2026-11-06, затверджено власником). Ціни в доларах, на місяць.
//   start — $29, plus — $59 (онлайн-оплата WayForPay).
//   ai — «З AI-продавцем»: 75% від витрат на токени бота за місяць (напр. токени $300 → $225), у ціну входять підтримка, виправлення
//        помилок і дрібні доопрацювання; онлайн-оплати немає, суму рахуємо за фактом місяця.
// Тексти для лендінгу — у ТАРИФИ-fineko-crm.md.
const DAY = 86400000;

const PLANS = {
  start: {
    code: 'start', name: 'Старт', priceUsd: 29, online: true, maxShops: 1, maxManagers: 3,
    summary: 'CRM для магазину в Instagram: замовлення, покупці, Нова пошта, прибуток.',
  },
  plus: {
    code: 'plus', name: 'Магазин+', priceUsd: 59, online: true, maxShops: 3, maxManagers: 10,
    summary: 'Усе зі «Старт» плюс реклама Meta, щоденна аналітика, звіт по менеджерах, постачальники.',
  },
  ai: {
    code: 'ai', name: 'З AI-продавцем', priceUsd: null, online: false, maxShops: 3, maxManagers: 10,
    summary: 'Усе з «Магазин+» плюс AI-продавець в Instagram. Платите 75% від витрат на токени бота за місяць.',
  },
};

// Скільки місяців можна оплатити за раз і яка знижка: 12 місяців = 10 (два місяці в подарунок).
const MONTH_OPTIONS = { 1: 1, 3: 3, 12: 10 };

const SOON_DAYS = 7; // за скільки днів до кінця підсвічуємо нагадування про оплату

function priceUsdFor(planCode, months) {
  const plan = PLANS[planCode];
  if (!plan || !plan.online) return null;
  const billable = MONTH_OPTIONS[Number(months)];
  if (!billable) return null;
  return plan.priceUsd * billable;
}

/**
 * Стан тарифу магазину для меню і сторінки «Тариф».
 * state: none (тариф не вказано) | unlimited (без дати закінчення) | ok | soon (лишилось ≤ 7 днів) | expired.
 * daysLeft рахуємо по днях за київським календарем не потрібно — достатньо цілих діб до кінця (округлення вгору).
 */
function planStatus(tenant, now = new Date()) {
  const plan = tenant && tenant.plan && PLANS[tenant.plan] ? PLANS[tenant.plan] : null;
  const endsAt = tenant && tenant.planEndsAt ? new Date(tenant.planEndsAt) : null;
  if (!plan) return { plan: null, planName: null, endsAt: null, daysLeft: null, state: 'none', isDemo: !!(tenant && tenant.isDemo) };
  if (!endsAt) return { plan: plan.code, planName: plan.name, endsAt: null, daysLeft: null, state: 'unlimited', isDemo: !!tenant.isDemo };
  const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / DAY);
  const state = daysLeft < 0 ? 'expired' : daysLeft <= SOON_DAYS ? 'soon' : 'ok';
  return { plan: plan.code, planName: plan.name, endsAt: endsAt.toISOString(), daysLeft, state, isDemo: !!tenant.isDemo };
}

/** Нова дата закінчення: від кінця поточного періоду (якщо він ще не минув), інакше від сьогодні, плюс оплачені місяці. */
function extendedEnd(currentEndsAt, months, now = new Date()) {
  const base = currentEndsAt && new Date(currentEndsAt).getTime() > now.getTime() ? new Date(currentEndsAt) : new Date(now);
  const d = new Date(base);
  d.setMonth(d.getMonth() + Number(months));
  return d;
}

module.exports = { PLANS, MONTH_OPTIONS, SOON_DAYS, priceUsdFor, planStatus, extendedEnd };
