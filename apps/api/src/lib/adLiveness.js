// «Реклама крутилась?» — 2026-11-14 (Edits Олексія 10.11: «замовлення з органіки привʼязуються до реклами, яку давно не рекламую»).
// Flows не відрізняє рекламу від допису чи сторіз: в entryAd лежить будь-який id медіа. Клієнт, що написав із давнього допису або лишив коментар
// під ним, отримував «рекламу» цього допису навіть через місяці після її вимкнення. Тепер реклама зараховується, лише якщо оголошення тоді
// працювало: були витрати за останні LIVE_WINDOW_DAYS днів до розмови, або Meta зараз каже «активне», або воно щойно зʼявилось і витрати ще не підтягнулись.
// Інакше розмова/замовлення — органіка (без реклами). Ручний вибір реклами менеджером (touch.adId) цим не перевіряється.
const { db } = require('@crm/db');

const LIVE_WINDOW_DAYS = 3;   // рішення власника 14.11: 3 дні
const FRESH_UNKNOWN_HOURS = 24; // оголошення без жодного рядка витрат і створене <доби тому — витрати ще не синхронізовано, довіряємо

function validDate(v) { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }

/** true — оголошення на момент at (за замовчуванням — зараз) вважається таким, що крутилось. */
async function adWasLive(ad, at, opts = {}) {
  if (!ad) return false;
  const t = validDate(at) || new Date();
  const days = opts.windowDays || LIVE_WINDOW_DAYS;
  const isNow = Math.abs(Date.now() - t.getTime()) < 36 * 3600e3; // «активне» від Meta доречне лише для свіжого дотику
  if (isNow && ad.effectiveStatus === 'ACTIVE') return true;
  const spent = await db.adSpendDaily.count({ where: { adId: ad.id, amount: { gt: 0 }, date: { gte: new Date(t.getTime() - days * 86400e3), lte: new Date(t.getTime() + 86400e3) } } });
  if (spent > 0) return true;
  // Витрат поруч немає. Зовсім нове оголошення (жодного рядка витрат узагалі) — даємо добу на синхронізацію з Meta.
  const anySpend = await db.adSpendDaily.count({ where: { adId: ad.id } });
  if (anySpend === 0 && ad.createdAt && t.getTime() - new Date(ad.createdAt).getTime() < FRESH_UNKNOWN_HOURS * 3600e3 && t.getTime() >= new Date(ad.createdAt).getTime() - 3600e3) return true;
  return false;
}

module.exports = { adWasLive, LIVE_WINDOW_DAYS };
