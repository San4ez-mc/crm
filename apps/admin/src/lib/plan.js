// Тариф магазину для меню й підсвітки нагадування про оплату (2026-11-06). Дублює правила api/src/lib/plans.js planStatus.
export const PLAN_NAMES = { start: 'Старт', plus: 'Магазин+', ai: 'З AI-продавцем' };
const DAY = 86400000;
export const SOON_DAYS = 7;

/** state: none | unlimited | ok | soon (≤ 7 днів) | expired. */
export function planInfo(tenant, now = new Date()) {
  if (!tenant || !tenant.plan) return { state: 'none', name: null, daysLeft: null, endsAt: null };
  const name = PLAN_NAMES[tenant.plan] || tenant.plan;
  if (!tenant.planEndsAt) return { state: 'unlimited', name, daysLeft: null, endsAt: null };
  const endsAt = new Date(tenant.planEndsAt);
  const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / DAY);
  return { state: daysLeft < 0 ? 'expired' : daysLeft <= SOON_DAYS ? 'soon' : 'ok', name, daysLeft, endsAt };
}

export const fmtEnd = (d) => (d ? new Date(d).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

export function daysWord(n) {
  const a = Math.abs(n) % 100; const b = a % 10;
  if (a > 10 && a < 20) return 'днів';
  if (b === 1) return 'день';
  if (b >= 2 && b <= 4) return 'дні';
  return 'днів';
}
