// Доступ до розділів CRM за сторінками з SSO-панелі (Access.pageIds), 2026-10-14.
//
// Навіщо: SSO віддавав pageIds, але CRM їх ігнорувала — будь-хто з доступом до магазину бачив аналітику, витрати, платежі
// і навіть ключ API магазину (GET /tenant). Менеджерам goverla треба лише замовлення/покупців/повернення.
// Правило: role=user із НЕПОРОЖНІМ pageIds — дозволено лише запити, які не належать закритим розділам; порожній pageIds = усі
// розділи (так записано в SSO: «[] = усі базові»), тож наявні користувачі нічого не втрачають. superadmin і ключ магазину
// (воронка/MCP) — без обмежень.
//
// Розділи, з яких сторінка замовлень бере дані (товари, категорії, етапи, постачальники), лишаються ДОСТУПНИМИ ДЛЯ ЧИТАННЯ;
// змінювати їх — лише з доступом до відповідної сторінки.

// [перевірка, сторінки-будь-яка-з-яких-відкриває] — перша відповідна перевірка вирішує.
const RULES = [
  // Аналітика (гроші: виручка, маржа, конверсія)
  [(m, p) => /^\/analytics\/daily(\/|$)/.test(p), ['daily-analytics', 'analytics']],
  [(m, p) => /^\/analytics(\/|$)/.test(p), ['analytics', 'daily-analytics', 'funnel-analytics']],
  [(m, p) => m === 'GET' && /^\/funnel-events\/(summary|stuck|funnels)(\/|$)/.test(p), ['funnel-analytics', 'analytics']],
  // Реклама: витрати і результати
  [(m, p) => /^\/(ad-spend|ad-spend-daily|ad-clicks)(\/|$)/.test(p) || /^\/ads\/(spend-summary|active-summary)(\/|$)/.test(p) || /^\/ads\/[^/]+\/detail(\/|$)/.test(p), ['ad-spend']],
  // Довідник оголошень (назви, без грошей) — читати можна всім: сторінка замовлень бере з нього фільтр «реклама».
  // Змінювати оголошення й рекламну атрибуцію замовлення — лише з доступом до розділів реклами.
  [(m, p) => m !== 'GET' && /^\/ads(\/|$)/.test(p), ['ads', 'ad-spend']],
  [(m, p) => m !== 'GET' && /^\/orders\/[^/]+\/attribution(\/|$)/.test(p), ['ads', 'ad-spend']],
  // Фінанси
  [(m, p) => /^\/payments(\/|$)/.test(p), ['payments']],
  [(m, p) => /^\/product-expenses(\/|$)/.test(p), ['product-expenses']],
  // Налаштування: ключ API магазину, ключ Нової Пошти, ФОПи, банківські секрети, інтеграції
  [(m, p) => /^\/(tenant|secrets|fops|integrations)(\/|$)/.test(p), ['settings-general', 'automations']],
  // Каталог і воронки — читати можна (потрібно сторінці замовлень), змінювати — лише з доступом до сторінки
  [(m, p) => m !== 'GET' && /^\/products(\/|$)/.test(p), ['products', 'sets']],
  [(m, p) => m !== 'GET' && /^\/categories(\/|$)/.test(p), ['categories']],
  [(m, p) => m !== 'GET' && /^\/suppliers(\/|$)/.test(p), ['suppliers']],
  [(m, p) => m !== 'GET' && /^\/knowledge(\/|$)/.test(p), ['knowledge']],
  [(m, p) => m !== 'GET' && /^\/pipelines(\/|$)/.test(p), ['pipelines']],
];

/** Сторінки, будь-яка з яких відкриває цей запит, або null — запит не належить закритому розділу. */
function requiredPages(method, path) {
  const m = String(method || 'GET').toUpperCase(); const p = String(path || '');
  for (const [test, pages] of RULES) if (test(m, p)) return pages;
  return null;
}

/** Чи дозволено запит користувачу з цими правами (role, pageIds). */
function isAllowed(access, method, path) {
  if (!access || access.role === 'superadmin') return true;
  const pageIds = Array.isArray(access.pageIds) ? access.pageIds : [];
  if (!pageIds.length) return true; // [] = усі розділи
  const need = requiredPages(method, path);
  return !need || need.some((pg) => pageIds.includes(pg));
}

module.exports = { requiredPages, isAllowed, RULES };
