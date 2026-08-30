// Парсинг ?from=&to= для періодних фільтрів. Дата-only рядок ("2026-08-30") із `to`
// парситься JS як 00:00:00 UTC того дня — без цього хелпера today's записи випадали б
// з lte-порівняння (знайдено тестуванням §6 аналітики). `to` завжди трактуємо як кінець доби.
function parseFrom(value) {
  if (!value) return null;
  return new Date(String(value));
}

function parseTo(value) {
  if (!value) return null;
  const str = String(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const date = new Date(str);
  if (dateOnly) date.setUTCHours(23, 59, 59, 999);
  return date;
}

module.exports = { parseFrom, parseTo };
