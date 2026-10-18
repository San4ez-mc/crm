// Instagram-нікнейм з будь-якого вводу менеджера (2026-10-18, Олексій: «не шукає клієнта по посиланню»).
// Менеджери вставляють посилання з телефону: https://www.instagram.com/vasiliinudik?vrfl=cTZjdG5tMnEzdjd3,
// instagram.com/x/, @x, з пробілами/слешем у кінці. Зберігаємо й шукаємо ЛИШЕ нікнейм (vasiliinudik) — інакше один
// клієнт лежить у базі трьома різними рядками і пошук за посиланням нічого не знаходить.
// Єдине місце правила на сервері (роути orders/buyers + MCP); дзеркало для форм — apps/admin/src/lib/instagram.js
// (тримати в синку; scripts/check-instagram-normalize.js перевіряє обидва на тих самих прикладах).

// Шляхи instagram.com, після яких нікнейму немає (пост, рілс, пошук) або він іде другим сегментом (stories/_u).
const NO_USER_SEGMENTS = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer', 'web']);
const USER_SECOND_SEGMENTS = new Set(['stories', '_u']);
const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

/** Нікнейм у нижньому регістрі або '' (порожній ввід чи з нього не видно нікнейма — напр. посилання на пост). */
function normalizeInstagram(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s) return '';
  s = s.replace(/^@+/, '').trim();
  const hostRe = /^(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)(?=[/?#]|$)/i;
  if (hostRe.test(s)) {
    const path = s.replace(hostRe, '').split(/[?#]/)[0];
    const segs = path.split('/').map((x) => x.trim()).filter(Boolean);
    if (!segs.length) return '';
    let user = segs[0];
    if (USER_SECOND_SEGMENTS.has(user.toLowerCase())) user = segs[1] || '';
    else if (NO_USER_SEGMENTS.has(user.toLowerCase())) return '';
    s = user.replace(/^@+/, '');
  } else {
    // Без домену: «vasiliinudik?igsh=…», «vasiliinudik/» — відкидаємо хвіст.
    s = s.split(/[?#\s]/)[0].replace(/\/+$/, '');
    if (s.includes('/')) return '';
  }
  s = s.toLowerCase();
  return USERNAME_RE.test(s) ? s : '';
}

/** Для запису в БД: нікнейм або null (порожньо/не розпізнано). */
function igOrNull(input) {
  return normalizeInstagram(input) || null;
}

/**
 * Пошуковий запит схожий на Instagram (посилання або @нік) → нікнейм для пошуку; інакше null —
 * тоді шукаємо як раніше (імʼя/телефон/ТТН).
 */
function igSearchTerm(q) {
  const s = String(q || '').trim();
  if (!s) return null;
  if (!/^@|instagram\.com|instagr\.am/i.test(s)) return null;
  return normalizeInstagram(s) || null;
}

module.exports = { normalizeInstagram, igOrNull, igSearchTerm };
