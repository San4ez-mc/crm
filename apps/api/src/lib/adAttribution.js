// Атрибуція «реклама → розмова → замовлення» — одне місце для всіх входів (картка воронки, оформлення, ручна правка, бекфіл).
//
// 2026-10-06: з 13.09 жодне замовлення не мало реклами (13 за весь час) — новий агент Flows не передавав, з якої реклами людина
// прийшла, а картка розмови (/funnel-events) рекламу не приймала взагалі. Flows знає лише id оголошення в Meta (externalId);
// внутрішній Ad.id визначає CRM — тут, а не кожен клієнт API окремо.
//
// Модель (відповідь Олексію, Edit 2f4d68fd): у кожного замовлення два дотики —
//   firstTouch — реклама, з якої людина ВПЕРШЕ прийшла в розмову (ставиться один раз, не перезаписується);
//   lastTouch  — остання реклама перед замовленням (оновлюється щоразу, коли людина приходить з іншої реклами).
// Звіти за замовчуванням зараховують замовлення першому дотику; «Реклама → конверсія» показує обидва.
const { db } = require('@crm/db');
const { linkAdVariantsFor, ensureLiveParent } = require('./adVariants');

async function findOrCreateAdByExternalId(tenantId, externalId, name, meta = {}) {
  let ad = await db.ad.findFirst({ where: { tenantId, externalId } });
  if (!ad) {
    ad = await db.ad.create({
      data: { tenantId, externalId, name: name || null, campaignId: meta.campaignId || null, campaignName: meta.campaignName || null, adAccountId: meta.adAccountId || null, thumbnailUrl: meta.thumbnailUrl || null },
    });
    await linkAdVariantsFor(ad).catch(() => null);
    ad = await db.ad.findUnique({ where: { id: ad.id } });
  } else if (meta.campaignName || meta.campaignId || meta.adAccountId || meta.thumbnailUrl) {
    // Meta не міняє campaignId/adAccountId заднім числом, але назва кампанії/фото креативу могли оновитись.
    ad = await db.ad.update({
      where: { id: ad.id },
      data: { ...(meta.campaignId ? { campaignId: meta.campaignId } : {}), ...(meta.campaignName ? { campaignName: meta.campaignName } : {}), ...(meta.adAccountId ? { adAccountId: meta.adAccountId } : {}), ...(meta.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}) },
    });
  }
  return ad;
}

/**
 * Оголошення за дописом Instagram (Ad.postId = effective_instagram_media_id). Meta не передала рекламу, але клієнт переслав
 * сам рекламний рілс (20.10, shumko_helen / nataliyaghubar, Edits 44c07e5b/ae75528c: «Відповідь на рекламу» в Instagram, а в
 * CRM «не вказано»). У допису кілька просувань — беремо те, що крутилось найближче до дотику (витрати ±3 дні), інакше найновіше.
 */
async function adByPostId(tenantId, postId, at) {
  const ads = await db.ad.findMany({ where: { tenantId, postId: String(postId), variantOfAdId: null }, select: { id: true, createdAt: true } });
  if (ads.length <= 1) return ads[0] ? db.ad.findUnique({ where: { id: ads[0].id } }) : null;
  const t = validDate(at) || new Date();
  const from = new Date(t.getTime() - 3 * 86400e3); const to = new Date(t.getTime() + 86400e3);
  const sp = await db.adSpendDaily.groupBy({ by: ['adId'], where: { adId: { in: ads.map((a) => a.id) }, date: { gte: from, lte: to } }, _sum: { amount: true } });
  const best = sp.sort((a, b) => Number(b._sum.amount || 0) - Number(a._sum.amount || 0))[0];
  const id = best ? best.adId : ads.sort((a, b) => b.createdAt - a.createdAt)[0].id;
  return db.ad.findUnique({ where: { id } });
}

function validDate(v) { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d : null; }

/**
 * Поля Order для дотиків. touch = { externalId, at?, name? } (Meta id) або { adId } (внутрішній, ручний вибір).
 * existing — поточний рядок (щоб firstTouch не перезаписувати, а lastTouch не відкотити на старіший).
 */
async function touchFields(tenantId, { firstTouch, lastTouch } = {}, existing = null) {
  const out = {};
  const resolve = async (t) => {
    if (!t) return null;
    let ad = null;
    if (t.adId) ad = await db.ad.findFirst({ where: { id: String(t.adId), tenantId } });
    else if (t.externalId) ad = await findOrCreateAdByExternalId(tenantId, String(t.externalId), t.name || null);
    else if (t.postId) ad = await adByPostId(tenantId, String(t.postId), t.at);
    // Варіант Advantage+ («_Group_1») — дотик зараховуємо справжньому оголошенню (lib/adVariants.js). На живому дотику
    // перевіряємо, що це оголошення тоді крутилось (2026-10-15: однойменні оголошення — варіант сидів на паузнутому).
    if (ad && ad.variantOfAdId) {
      const parentId = await ensureLiveParent(ad, t.at).catch(() => ad.variantOfAdId);
      ad = (await db.ad.findFirst({ where: { id: parentId || ad.variantOfAdId, tenantId } })) || ad;
    }
    return ad;
  };
  if (firstTouch && !(existing && existing.firstTouchAdId)) {
    const ad = await resolve(firstTouch);
    if (ad) { out.firstTouchAdId = ad.id; out.firstTouchAt = validDate(firstTouch.at) || new Date(); }
  }
  if (lastTouch) {
    const at = validDate(lastTouch.at) || new Date();
    if (!(existing && existing.lastTouchAt && existing.lastTouchAt > at)) {
      const ad = await resolve(lastTouch);
      if (ad) { out.lastTouchAdId = ad.id; out.lastTouchAt = at; }
    }
  }
  return out;
}

/**
 * Реклама для замовлення, створеного НЕ з розмови (вручну, EasyDrop): з картки розмови того ж клієнта (нікнейм Instagram), де бот
 * її записав, — за останні 14 днів. 26.10 (власник, план А8): раніше це робили разовим скриптом, у нових ручних замовленнях реклами не було.
 */
async function touchFromCard(tenantId, ig, before) {
  const nick = String(ig || '').trim().replace(/^@/, '');
  if (!nick) return {};
  const t = before || new Date();
  const card = await db.order.findFirst({
    where: { tenantId, funnelSessionId: { not: null }, firstTouchAdId: { not: null }, contactIg: { equals: nick, mode: 'insensitive' }, createdAt: { gte: new Date(t.getTime() - 14 * 86400e3), lte: t } },
    orderBy: { createdAt: 'desc' },
    select: { firstTouchAdId: true, firstTouchAt: true, lastTouchAdId: true, lastTouchAt: true },
  });
  if (!card) return {};
  return { firstTouchAdId: card.firstTouchAdId, firstTouchAt: card.firstTouchAt || t, lastTouchAdId: card.lastTouchAdId || card.firstTouchAdId, lastTouchAt: card.lastTouchAt || card.firstTouchAt || t };
}

module.exports = { findOrCreateAdByExternalId, touchFields, adByPostId, touchFromCard };
