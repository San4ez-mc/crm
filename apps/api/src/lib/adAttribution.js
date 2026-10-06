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

async function findOrCreateAdByExternalId(tenantId, externalId, name, meta = {}) {
  let ad = await db.ad.findFirst({ where: { tenantId, externalId } });
  if (!ad) {
    ad = await db.ad.create({
      data: { tenantId, externalId, name: name || null, campaignId: meta.campaignId || null, campaignName: meta.campaignName || null, adAccountId: meta.adAccountId || null, thumbnailUrl: meta.thumbnailUrl || null },
    });
  } else if (meta.campaignName || meta.campaignId || meta.adAccountId || meta.thumbnailUrl) {
    // Meta не міняє campaignId/adAccountId заднім числом, але назва кампанії/фото креативу могли оновитись.
    ad = await db.ad.update({
      where: { id: ad.id },
      data: { ...(meta.campaignId ? { campaignId: meta.campaignId } : {}), ...(meta.campaignName ? { campaignName: meta.campaignName } : {}), ...(meta.adAccountId ? { adAccountId: meta.adAccountId } : {}), ...(meta.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}) },
    });
  }
  return ad;
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
    if (t.adId) return db.ad.findFirst({ where: { id: String(t.adId), tenantId } });
    if (t.externalId) return findOrCreateAdByExternalId(tenantId, String(t.externalId), t.name || null);
    return null;
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

module.exports = { findOrCreateAdByExternalId, touchFields };
