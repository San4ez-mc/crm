// Розділи адмінки ↔ сторінки SSO-панелі (той самий список, що PAGES у api/src/routes/auth-sso.js), 2026-10-14.
// pageIds з /me: [] = усі розділи; непорожній — лише перелічені (напр. менеджери: замовлення, покупці, повернення).
// Сервер перевіряє те саме (api/src/lib/pageAccess.js) — тут лише щоб не показувати закрите.
const PAGE_BY_PATH = [
  ['/products', 'products'], ['/sets', 'sets'], ['/categories', 'categories'], ['/suppliers', 'suppliers'], ['/knowledge', 'knowledge'],
  ['/pipelines', 'pipelines'], ['/orders', 'orders'], ['/buyers', 'buyers'], ['/returns', 'returns'],
  ['/analytics', 'analytics'], ['/funnel-analytics', 'funnel-analytics'], ['/daily-analytics', 'daily-analytics'],
  ['/ad-spend', 'ad-spend'], ['/ads', 'ads'], ['/payments', 'payments'], ['/product-expenses', 'product-expenses'],
  ['/settings/general', 'settings-general'], ['/automations', 'automations'],
];

export function pageOfPath(path) {
  const p = String(path || '');
  const hit = PAGE_BY_PATH.find(([prefix]) => p === prefix || p.startsWith(prefix + '/'));
  return hit ? hit[1] : null;
}

/** Чи бачить користувач розділ за шляхом. */
export function canSeePath(path, { role, pageIds } = {}) {
  if (role === 'superadmin' || !Array.isArray(pageIds) || !pageIds.length) return true;
  const page = pageOfPath(path);
  return !page || pageIds.includes(page);
}

/** Перший дозволений розділ — куди вести з закритого. */
export function firstAllowedPath(access) {
  const order = ['/orders', '/buyers', '/returns', '/products', '/pipelines'];
  return order.find((p) => canSeePath(p, access)) || (PAGE_BY_PATH.find(([p]) => canSeePath(p, access)) || ['/orders'])[0];
}
