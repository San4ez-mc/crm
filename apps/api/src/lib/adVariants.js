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
const { db } = require('@crm/db');

const PSEUDO_ACCOUNT = 'instagram_messages';
const VARIANT_RE = /_Group_\d+\s*$/;
const MAX_GAP_STEPS = 50000n;
const STEP = 10000n;

function normAdName(s) {
  return String(s || '').toLowerCase().replace(/_group_\d+\s*$/, '').replace(/\.{2,}\s*$/, '').replace(/[ʼ'’`]/g, '').replace(/[^0-9a-zа-яіїєґ]+/gi, ' ').trim();
}
function isVariant(ad) { return !!ad && VARIANT_RE.test(ad.name || '') && /^\d+$/.test(ad.externalId || '') && (!ad.adAccountId || ad.adAccountId === PSEUDO_ACCOUNT); }
function isReal(ad) { return !!ad && /^act_/.test(ad.adAccountId || '') && /^\d+$/.test(ad.externalId || ''); }

function pickParent(variant, candidates) {
  const vid = BigInt(variant.externalId); const vn = normAdName(variant.name);
  let best = null;
  for (const c of candidates) {
    if (!isReal(c) || normAdName(c.name) !== vn) continue;
    const cid = BigInt(c.externalId);
    if (cid < vid && (vid - cid) / STEP <= MAX_GAP_STEPS && (!best || cid > BigInt(best.externalId))) best = c;
  }
  return best;
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

const REAL_SELECT = { id: true, tenantId: true, externalId: true, name: true, adAccountId: true, productId: true };
async function realAds(tenantId) { return db.ad.findMany({ where: { tenantId, adAccountId: { startsWith: 'act_' } }, select: REAL_SELECT }); }

/** Після створення/оновлення оголошення: варіант → шукаємо його оголошення; справжнє → підхоплюємо його варіанти, що чекали. */
async function linkAdVariantsFor(ad) {
  if (!ad || ad.variantOfAdId) return null;
  if (isVariant(ad)) {
    const parent = pickParent(ad, await realAds(ad.tenantId));
    return parent ? attach(ad, parent) : null;
  }
  if (isReal(ad)) {
    const n = normAdName(ad.name);
    const waiting = (await db.ad.findMany({ where: { tenantId: ad.tenantId, variantOfAdId: null, name: { contains: '_Group_' } } })).filter((v) => isVariant(v) && normAdName(v.name) === n);
    if (!waiting.length) return null;
    // Варіант належить найближчому оголошенню з цією назвою — не обовʼязково щойно синхронізованому.
    const cands = await realAds(ad.tenantId); let orders = 0;
    for (const v of waiting) { const parent = pickParent(v, cands); if (parent) orders += (await attach(v, parent)).orders; }
    return { orders };
  }
  return null;
}

/** Повний прохід по tenant (бекфіл, ручний запуск). */
async function linkAllAdVariants(tenantId, { dryRun = false } = {}) {
  const all = await db.ad.findMany({ where: { tenantId }, select: { id: true, tenantId: true, externalId: true, name: true, adAccountId: true, productId: true, variantOfAdId: true } });
  const real = all.filter(isReal);
  const res = { variants: 0, linked: 0, orders: 0, unmatched: [] };
  for (const v of all.filter((a) => isVariant(a) && !a.variantOfAdId)) {
    res.variants++;
    const parent = pickParent(v, real);
    if (!parent) { res.unmatched.push({ externalId: v.externalId, name: v.name }); continue; }
    res.linked++;
    if (!dryRun) res.orders += (await attach(v, parent)).orders;
  }
  return res;
}

/** Внутрішній Ad.id → id справжнього оголошення, якщо це варіант (ручний вибір у замовленні, передача id напряму). */
async function canonicalAdId(tenantId, adId) {
  if (!adId) return adId;
  const ad = await db.ad.findFirst({ where: { id: String(adId), tenantId }, select: { variantOfAdId: true } });
  return (ad && ad.variantOfAdId) || adId;
}

module.exports = { canonicalAdId, normAdName, isVariant, isReal, pickParent, linkAdVariantsFor, linkAllAdVariants, PSEUDO_ACCOUNT };
