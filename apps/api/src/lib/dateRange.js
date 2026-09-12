// Парсинг ?from=&to= для періодних фільтрів + групування "по днях" для щоденних звітів.
// 2026-09-12 (аудит аналітики за проханням власника): і межі from/to, і "день" у щоденних
// звітах раніше рахувались по UTC (`new Date(str)` / `toISOString().slice(0,10)`) — сервер
// живе в UTC, а власник читає "сьогодні"/"вчора" за київським часом (UTC+2 взимку, UTC+3
// влітку). Замовлення, зроблене о 00:00–02:59 за Києвом, потрапляло у "вчорашній" день на
// графіках і у "вчорашній" період при виборі дати в UI — систематичний зсув на 2-3 години
// щодня, не рідкісний edge-case. Тепер усе прив'язане до Europe/Kyiv, DST враховується
// автоматично через Intl (не хардкодимо +2/+3).
const KYIV_TZ = 'Europe/Kyiv';

// Календарна дата timestamp-у В КИЄВІ (для groupBy "по днях" — /analytics/daily,
// /analytics/product-daily, тренд оголошення в routes/ads.js).
function kyivDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: KYIV_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}

// Зсув часового поясу timeZone відносно UTC (мс) у момент instant: local = UTC + offset.
function tzOffsetMs(timeZone, instant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - instant.getTime();
}

// "YYYY-MM-DD" + година/хвилина/секунда КИЇВСЬКОГО часу -> точний UTC Date. Офсет залежить
// від конкретної дати (зима/літо) — тому спочатку наближення "як UTC", потім одне уточнення
// вже по знайденому офсету (двох ітерацій достатньо, межа доби не потрапляє на сам момент
// переходу зима/літо, який в Україні стається о 3-4 ранку).
function kyivDateToUtc(dateStr, h, m, s, ms) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  // Офсет рахуємо на рівні цілих секунд (ms=0) — formatToParts усе одно не бачить мілісекунд,
  // тож instant.getTime() із ненульовим ms псував би обчислений offset на ці самі мілісекунди.
  // ms додаємо окремо в самому кінці, вже після того як секундна межа знайдена коректно.
  let guessSec = Date.UTC(y, mo - 1, d, h, m, s, 0);
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMs(KYIV_TZ, new Date(guessSec));
    guessSec = Date.UTC(y, mo - 1, d, h, m, s, 0) - offset;
  }
  return new Date(guessSec + ms);
}

function parseFrom(value) {
  if (!value) return null;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return kyivDateToUtc(str, 0, 0, 0, 0);
  return new Date(str); // повний timestamp прийшов явно — довіряємо як є
}

function parseTo(value) {
  if (!value) return null;
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return kyivDateToUtc(str, 23, 59, 59, 999);
  return new Date(str);
}

module.exports = { parseFrom, parseTo, kyivDayKey };
