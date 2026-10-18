// «_Group_1» — варіант оголошення Meta, а не окрема реклама (2026-10-14).
//
// Олексій просуває пости з увімкненим «Рекламний матеріал Advantage+». Тоді Meta в рефералі розмови (ad_id, ad_title) шле
// НЕ id оголошення з Ads Manager, а id внутрішнього варіанта: назва та сама + «_Group_1», id у Ads Manager не знайти, Graph API
// його не віддає (ні системному токену, ні токену Instagram — перевірено живими викликами). Через це всі розмови й продажі
// осідали на «оголошеннях» з псевдо-кабінету instagram_messages, а справжні оголошення (з витратами) мали нулі.
//
// Звʼязок відновлюємо за даними, які маємо: варіант створюється в Meta через секунди після свого оголошення, тож його id —
// найближчий БІЛЬШИЙ за id справжнього оголошення з тією ж назвою. Перевірено на goverla 14.10: 80 з 82 варіантів знайшли пару,
// розрив ≤ 5 409 кроків id (крок = 10 000), жодного далекого збігу. Межа MAX_GAP_STEPS — із запасом, але далека пара (інше
// оголошення з тією ж назвою через тижні) не підхопиться.
//
// 2026-10-15 (Edits 9ad83120/09ba3c2c, Олексій: «невірно привʼязало оголошення»): в Олексія кілька оголошень з ОДНАКОВОЮ
// назвою («Останні дні розпродажу. Осіння...» — три просування трьох різних постів за хвилину). Варіант 120250342790830329
// найближчим меншим id потрапив на 120250342789140329 — а воно на паузі з 26.08 і за жовтень не витратило ні цента, тож
// клієнти 15.10 ніяк не могли прийти з нього. Тепер серед однойменних кандидатів перевага тим, що РЕАЛЬНО крутяться
// (витрати в Ads Manager за останні дні, або щойно запущене ACTIVE) — і якщо дотик іде через варіант, чий «батько» вже
// не крутиться, а однойменне живе оголошення є, варіант перепривʼязується (ensureLiveParent), разом із замовленнями,
// що прийшли після останнього дня витрат старого.
const { db } = require('@crm/db');
const { dayRange } = require('./dateRange');

const PSEUDO_ACCOUNT = 'instagram_messages';
const VARIANT_RE = /_Group_\d+\s*$/;
const MAX_GAP_STEPS = 50000n;
const STEP = 10000n;

function normAdName(s) {
  return String(s || '').toLowerCase().replace(/_group_\d+\s*$/, '').replace(/\.{2,}\s*$/, '').replace(/[ʼ'’`]/g, '').replace(/[^0-9a-zа-яіїєґ]+/gi, ' ').trim();
}
function isVariant(ad) { return !!ad && VARIANT_RE.test(ad.name || '') && /^\d+$/.test(ad.externalId || '') && (!ad.adAccountId || ad.adAccountId === PSEUDO_ACCOUNT); }
function isReal(ad) { return !!ad && /^act_/.test(ad.adAccountId || '') && /^\d+$/.test(ad.externalId || ''); }

// Однойменні справжні оголошення з меншим id у межах розриву — можливі «батьки» варіанта.
function sameNameCandidates(variant, candidates) {
  const vid = BigInt(variant.externalId); const vn = normAdName(variant.name);
  return candidates.filter((c) => {
    if (!isReal(c) || normAdName(c.name) !== vn) return false;
    const cid = BigInt(c.externalId);
    return cid < vid && (vid - cid) / STEP <= MAX_GAP_STEPS;
  });
}
function nearest(list) { let best = null; for (const c of list) if (!best || BigInt(c.externalId) > BigInt(best.externalId)) best = c; return best; }

/** live — Set id оголошень, що крутились на момент дотику (liveAdIds). Серед них — найближче менше; інакше — як раніше. */
function pickParent(variant, candidates, live = null) {
  const pool = sameNameCandidates(variant, candidates);
  if (live && live.size) { const alive = pool.filter((c) => live.has(c.id)); if (alive.length) return nearest(alive); }
  return nearest(pool);
}

const LIVE_DAYS = 3;
/** Які з оголошень крутились у [at − 3 дні, at]: витрати > 0 у ці дні (Ads Manager) або ACTIVE, запущене за ці дні (витрат ще нема). */
async function liveAdIds(ads, at = new Date()) {
  if (!ads.length) return new Set();
  const until = dayRange({ lte: at }).lte;
  const since = new Date(until.getTime() - LIVE_DAYS * 86400000);
  const rows = await db.adSpendDaily.groupBy({ by: ['adId'], where: { adId: { in: ads.map((a) => a.id) }, date: { gte: since, lte: until }, amount: { gt: 0 } } });
  const out = new Set(rows.map((r) => r.adId));
  for (const a of ads) if (a.effectiveStatus === 'ACTIVE' && a.adCreatedAt && new Date(a.adCreatedAt) >= new Date(at.getTime() - LIVE_DAYS * 86400000)) out.add(a.id);
  return out;
}
async function pickLiveParent(variant, real, at) {
  const pool = sameNameCandidates(variant, real);
  return pickParent(variant, pool, await liveAdIds(pool, at || new Date()));
}

/** Привʼязати варіант до оголошення: товар — в обидва боки, де бракує; дотики замовлень — на справжнє оголошення. */
async function attach(variant, parent) {
  await db.ad.update({ where: { id: variant.id }, data: { variantOfAdId: parent.id, ...(!variant.productId && parent.productId ? { productId: parent.productId, productLinkSource: 'auto_variant', productLinkNote: 'товар справжнього оголошення ' + parent.externalId } : {}) } });
  if (!parent.productId && variant.productId) await db.ad.update({ where: { id: parent.id }, data: { productId: variant.productId, productLinkSource: 'auto_variant', productLinkNote: 'товар з розмов варіанта ' + variant.externalId } });
  const [a, b] = await Promise.all([
    db.order.updateMany({ where: { tenantId: variant.tenantId, firstTouchAdId: variant.id }, data: { firstTouchAdId: parent.id } }),
    db.order.updateMany({ where: { tenantId: variant.tenantId, lastTouchAdId: variant.id }, data: { lastTouchAdId: parent.id } }),
  ]);
  return { orders: a.count + b.count };
}

const REAL_SELECT = { id: true, tenantId: true, externalId: true, name: true, adAccountId: true, productId: true, effectiveStatus: true, adCreatedAt: true };
async function realAds(tenantId) { return db.ad.findMany({ where: { tenantId, adAccountId: { startsWith: 'act_' } }, select: REAL_SELECT }); }

/** Після створення/оновлення оголошення: варіант → шукаємо його оголошення; справжнє → підхоплюємо його варіанти, що чекали. */
async function linkAdVariantsFor(ad) {
  if (!ad || ad.variantOfAdId) return null;
  if (isVariant(ad)) {
    const parent = await pickLiveParent(ad, await realAds(ad.tenantId), ad.createdAt ? new Date(ad.createdAt) : new Date());
    return parent ? attach(ad, parent) : null;
  }
  if (isReal(ad)) {
    const n = normAdName(ad.name);
    const waiting = (await db.ad.findMany({ where: { tenantId: ad.tenantId, variantOfAdId: null, name: { contains: '_Group_' } } })).filter((v) => isVariant(v) && normAdName(v.name) === n);
    if (!waiting.length) return null;
    // Варіант належить найближчому оголошенню з цією назвою — не обовʼязково щойно синхронізованому.
    const cands = await realAds(ad.tenantId); let orders = 0;
    for (const v of waiting) { const parent = await pickLiveParent(v, cands, v.createdAt ? new Date(v.createdAt) : new Date()); if (parent) orders += (await attach(v, parent)).orders; }
    return { orders };
  }
  return null;
}

/** Повний прохід по tenant (бекфіл, ручний запуск). */
async function linkAllAdVariants(tenantId, { dryRun = false } = {}) {
  const all = await db.ad.findMany({ where: { tenantId }, select: { ...REAL_SELECT, variantOfAdId: true, createdAt: true } });
  const real = all.filter(isReal);
  const res = { variants: 0, linked: 0, orders: 0, unmatched: [] };
  for (const v of all.filter((a) => isVariant(a) && !a.variantOfAdId)) {
    res.variants++;
    const parent = await pickLiveParent(v, real, v.createdAt ? new Date(v.createdAt) : new Date());
    if (!parent) { res.unmatched.push({ externalId: v.externalId, name: v.name }); continue; }
    res.linked++;
    if (!dryRun) res.orders += (await attach(v, parent)).orders;
  }
  return res;
}

/**
 * Перепривʼязати варіант до іншого оголошення. Замовлення старого «батька» переносяться лише ті, чий дотик — після його
 * останнього дня витрат (+1 день запасу): тоді воно вже не крутилось, і прийти з нього клієнт не міг. Старіші лишаються.
 */
async function relinkVariant(variant, oldParentId, newParent, { dryRun = false } = {}) {
  const [last, first] = await Promise.all([
    db.adSpendDaily.aggregate({ where: { adId: oldParentId, amount: { gt: 0 } }, _max: { date: true } }),
    db.adSpendDaily.aggregate({ where: { ad: { tenantId: variant.tenantId } }, _min: { date: true } }),
  ]);
  const base = last._max.date || first._min.date;
  const cutoff = base ? new Date(new Date(base).getTime() + 2 * 86400000) : null;
  const moveWhere = (field, at) => ({ tenantId: variant.tenantId, [field]: oldParentId, ...(cutoff ? { [at]: { gte: cutoff } } : { id: '__none__' }) });
  if (dryRun) {
    const [a, b] = await Promise.all([db.order.count({ where: moveWhere('firstTouchAdId', 'firstTouchAt') }), db.order.count({ where: moveWhere('lastTouchAdId', 'lastTouchAt') })]);
    return { from: oldParentId, to: newParent.id, cutoff, firstTouch: a, lastTouch: b, dryRun: true };
  }
  await db.ad.update({ where: { id: variant.id }, data: { variantOfAdId: newParent.id } });
  if (!newParent.productId && variant.productId) await db.ad.update({ where: { id: newParent.id }, data: { productId: variant.productId, productLinkSource: 'auto_variant', productLinkNote: 'товар з розмов варіанта ' + variant.externalId } });
  const [a, b] = await Promise.all([
    db.order.updateMany({ where: moveWhere('firstTouchAdId', 'firstTouchAt'), data: { firstTouchAdId: newParent.id } }),
    db.order.updateMany({ where: moveWhere('lastTouchAdId', 'lastTouchAt'), data: { lastTouchAdId: newParent.id } }),
  ]);
  return { from: oldParentId, to: newParent.id, cutoff, firstTouch: a.count, lastTouch: b.count };
}

// Перевірка «батька» на живому дотику — не частіше разу на годину на варіант (дотики йдуть з кожною подією розмови).
const _liveCheck = new Map();
/**
 * Дотик через варіант (at — момент дотику): якщо його «батько» тоді не крутився, а однойменне живе оголошення є —
 * перепривʼязати. Старі дотики (бекфіл, > 2 діб) і стан без даних про витрати нічого не змінюють. Повертає id «батька»
 * (dryRun — опис того, що змінилось би).
 */
async function ensureLiveParent(variant, at, { force = false, dryRun = false } = {}) {
  if (!variant || !variant.variantOfAdId || !isVariant(variant)) return variant && variant.variantOfAdId;
  const atD = at ? new Date(at) : new Date();
  if (Number.isNaN(atD.getTime()) || Date.now() - atD.getTime() > 2 * 86400000) return variant.variantOfAdId;
  const seen = _liveCheck.get(variant.id);
  if (!force && seen && Date.now() - seen.t < 3600000) return seen.parentId;
  let parentId = variant.variantOfAdId;
  const pool = sameNameCandidates(variant, await realAds(variant.tenantId));
  const live = await liveAdIds(pool, atD);
  if (live.size && !live.has(parentId)) {
    const better = pickParent(variant, pool, live);
    if (better && better.id !== parentId) {
      const r = await relinkVariant(variant, parentId, better, { dryRun });
      if (dryRun) return r;
      parentId = better.id;
    }
  } else if (dryRun) return { from: parentId, unchanged: true, parentLive: live.has(parentId) };
  if (!dryRun) _liveCheck.set(variant.id, { t: Date.now(), parentId });
  return parentId;
}

/** Ручна перевірка конкретних варіантів (Meta-id) — POST /ads/link-variants { relinkExternalIds }. */
async function relinkVariantsByExternalId(tenantId, externalIds, { dryRun = false } = {}) {
  const out = [];
  for (const ext of externalIds) {
    const v = await db.ad.findFirst({ where: { tenantId, externalId: String(ext) } });
    if (!v || !v.variantOfAdId) { out.push({ externalId: String(ext), skipped: v ? 'not_linked' : 'not_found' }); continue; }
    out.push({ externalId: String(ext), result: await ensureLiveParent(v, new Date(), { force: true, dryRun }) });
  }
  return out;
}

/** Внутрішній Ad.id → id справжнього оголошення, якщо це варіант (ручний вибір у замовленні, передача id напряму). */
async function canonicalAdId(tenantId, adId) {
  if (!adId) return adId;
  const ad = await db.ad.findFirst({ where: { id: String(adId), tenantId }, select: { variantOfAdId: true } });
  return (ad && ad.variantOfAdId) || adId;
}

/** Товар оголошення змінили — його варіанти Advantage+ без власного (або з автоматично успадкованим) товару отримують той самий (18.10).
 *  Одне місце для REST (PATCH /ads/:id) і MCP (update_ad). */
async function propagateProductToVariants(tenantId, adId, productId) {
  return db.ad.updateMany({ where: { tenantId, variantOfAdId: adId, OR: [{ productId: null }, { productLinkSource: 'auto_variant' }] }, data: { productId: productId || null, productLinkSource: productId ? 'auto_variant' : null, productLinkNote: productId ? 'товар справжнього оголошення' : null } });
}

module.exports = { propagateProductToVariants, canonicalAdId, normAdName, isVariant, isReal, pickParent, liveAdIds, linkAdVariantsFor, linkAllAdVariants, ensureLiveParent, relinkVariantsByExternalId, PSEUDO_ACCOUNT };
