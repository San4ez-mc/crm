// Конвертація рекламних витрат у гривню (2026-09-07, фідбек власника): Meta Ads пише
// AdSpendDaily.amount у ВЛАСНІЙ валюті рекламного кабінету (перевірено на проді — всі рядки
// вже коректно позначені currency:'USD'), а решта грошових показників (виручка/собівартість/
// маржа/постійні витрати) — у гривні. Без конвертації "Очікуваний прибуток"/ROI підмішували
// долар до гривні як 1:1 — цифри були абсурдними.
//
// Курс береться з Tenant.usdExchangeRate. Джерело — Нацбанк України (безкоштовне, без ключа,
// офіційний курс): https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json
const { db } = require('@crm/db');
const logger = require('@crm/logger');

const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json';
const STALE_MS = 12 * 3600 * 1000; // курс НБУ оновлюється раз на добу — 12 год цілком достатньо
const RETRY_BACKOFF_MS = 10 * 60 * 1000; // якщо НБУ впав — не бити його на КОЖЕН запит аналітики
let lastFailedAttemptAt = 0; // in-memory per-процес — гірше з pm2 cluster (кожен воркер свій), але не критично

async function fetchUsdToUahFromNbu() {
  const res = await fetch(NBU_URL, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`НБУ повернув HTTP ${res.status}`);
  const json = await res.json();
  const rate = Number(json?.[0]?.rate);
  if (!rate || !Number.isFinite(rate)) throw new Error('НБУ: не вдалось розпізнати курс у відповіді');
  return rate;
}

// Best-effort автооновлення — якщо курс старший за STALE_MS (або взагалі не заповнений),
// підтягуємо свіжий з НБУ і зберігаємо. НБУ недоступний/впав → тихо лишаємось на старому
// курсі (краще трохи застарілий курс, ніж 500-а на всій аналітиці через зовнішній сервіс).
async function ensureFreshUsdRate(tenant) {
  const isStale = !tenant.usdExchangeRate || !tenant.usdExchangeRateUpdatedAt
    || (Date.now() - new Date(tenant.usdExchangeRateUpdatedAt).getTime() > STALE_MS);
  if (!isStale) return tenant;
  // НБУ щойно впав? Не бʼємо його на КОЖЕН запит аналітики — почекаємо RETRY_BACKOFF_MS
  // (не чіпаємо usdExchangeRateUpdatedAt при невдачі — це поле означає "коли курс РЕАЛЬНО
  // оновився", Settings-сторінка на нього спирається для показу власнику).
  if (Date.now() - lastFailedAttemptAt < RETRY_BACKOFF_MS) return tenant;
  try {
    const rate = await fetchUsdToUahFromNbu();
    return await db.tenant.update({ where: { id: tenant.id }, data: { usdExchangeRate: rate, usdExchangeRateUpdatedAt: new Date() } });
  } catch (e) {
    lastFailedAttemptAt = Date.now();
    logger.warn('ensureFreshUsdRate: НБУ недоступний, лишаємось на старому курсі', { tenantId: tenant.id, error: e.message });
    return tenant;
  }
}

// Одна сума (amount, currency) -> гривня. Наразі підтримуємо лише USD/UAH (єдині валюти, які
// пише Meta-sync-воронка) — якщо колись зʼявиться третя, це єдине місце для правки.
function rowToUAH(amount, currency, usdRate) {
  const n = Number(amount || 0);
  if (currency === 'USD') return usdRate > 0 ? n * usdRate : n; // без курсу — краще "як є", ніж занулити
  return n;
}

// Сума AdSpendDaily.amount по WHERE, одразу в гривнях — groupBy по валюті (не по кожному
// рядку), щоб не тягнути тисячі рядків заради простого SUM.
async function sumAdSpendUAH(where, usdRate) {
  const groups = await db.adSpendDaily.groupBy({ by: ['currency'], where, _sum: { amount: true } });
  return groups.reduce((sum, g) => sum + rowToUAH(g._sum.amount, g.currency, usdRate), 0);
}

module.exports = { fetchUsdToUahFromNbu, ensureFreshUsdRate, rowToUAH, sumAdSpendUAH };
