// Instagram-нікнейм з посилання/«@нік» (2026-10-18) — дзеркало apps/api/src/lib/instagram.js (тримати в синку;
// scripts/check-instagram-normalize.js перевіряє обидва). Сервер нормалізує сам на кожному збереженні — тут лише щоб
// менеджер одразу бачив у полі нікнейм, а не довге посилання.
const NO_USER_SEGMENTS = new Set(['p', 'reel', 'reels', 'tv', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer', 'web']);
const USER_SECOND_SEGMENTS = new Set(['stories', '_u']);
const USERNAME_RE = /^[a-z0-9._]{1,30}$/;

export function normalizeInstagram(input) {
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
    s = s.split(/[?#\s]/)[0].replace(/\/+$/, '');
    if (s.includes('/')) return '';
  }
  s = s.toLowerCase();
  return USERNAME_RE.test(s) ? s : '';
}

/**
 * Значення для поля вводу під час набору: вставлене посилання/«@нік» одразу стає нікнеймом, а звичайний набір не
 * чіпаємо (інакше «instagram.com/» стерлось би, поки менеджер друкує). Остаточно — normalizeInstagram на blur/збереженні.
 */
export function igInputValue(raw) {
  const s = String(raw || '');
  if (!/instagram\.com\/[^/?#\s]+|instagr\.am\/[^/?#\s]+|^\s*@|\?/.test(s)) return s;
  return normalizeInstagram(s) || s;
}
