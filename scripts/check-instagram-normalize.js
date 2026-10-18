// Перевірка нормалізації Instagram-нікнейма (2026-10-18): серверна (apps/api/src/lib/instagram.js) і дзеркало форм
// (apps/admin/src/lib/instagram.js) на тих самих прикладах — посилання, які реально вставляють менеджери.
// Запуск: node scripts/check-instagram-normalize.js  (виходить з кодом 1, якщо хоч один приклад не збігся).
const path = require('path');
const { pathToFileURL } = require('url');
const api = require('../apps/api/src/lib/instagram');

const CASES = [
  ['https://www.instagram.com/vasiliinudik?vrfl=cTZjdG5tMnEzdjd3', 'vasiliinudik'],
  ['https://www.instagram.com/matsukoleksandr?mdxt=b2M3czJlbm55MTRh', 'matsukoleksandr'],
  ['https://www.instagram.com/vasiliinudik/', 'vasiliinudik'],
  ['https://instagram.com/vasiliinudik/?igsh=MWx0eWR3', 'vasiliinudik'],
  ['instagram.com/vasiliinudik/', 'vasiliinudik'],
  ['www.instagram.com/Vasiliinudik', 'vasiliinudik'],
  ['http://m.instagram.com/vasilii.nudik_', 'vasilii.nudik_'],
  ['https://www.instagram.com/stories/vasiliinudik/3456789/', 'vasiliinudik'],
  ['https://www.instagram.com/_u/vasiliinudik', 'vasiliinudik'],
  ['@vasiliinudik', 'vasiliinudik'],
  ['  @VasiliiNudik  ', 'vasiliinudik'],
  ['vasiliinudik', 'vasiliinudik'],
  ['vasiliinudik/', 'vasiliinudik'],
  ['vasiliinudik?igsh=abc', 'vasiliinudik'],
  ['https://www.instagram.com/p/C8xYzAbc123/', ''], // пост — нікнейма в посиланні немає
  ['https://www.instagram.com/reel/C8xYzAbc123/', ''],
  ['https://www.instagram.com/', ''],
  ['Василь Нудик', ''],
  ['', ''],
  [null, ''],
];

const SEARCH_CASES = [
  ['https://www.instagram.com/vasiliinudik?vrfl=cTZjdG5tMnEzdjd3', 'vasiliinudik'],
  ['@matsukoleksandr', 'matsukoleksandr'],
  ['0671234567', null], // телефон — звичайний пошук
  ['Олена', null],
];

(async () => {
  const admin = await import(pathToFileURL(path.join(__dirname, '../apps/admin/src/lib/instagram.js')).href);
  let failed = 0;
  for (const [input, want] of CASES) {
    for (const [label, fn] of [['api', api.normalizeInstagram], ['admin', admin.normalizeInstagram]]) {
      const got = fn(input);
      if (got !== want) { failed++; console.error(`FAIL [${label}] ${JSON.stringify(input)} → ${JSON.stringify(got)}, очікувалось ${JSON.stringify(want)}`); }
    }
  }
  for (const [q, want] of SEARCH_CASES) {
    const got = api.igSearchTerm(q);
    if (got !== want) { failed++; console.error(`FAIL [search] ${JSON.stringify(q)} → ${JSON.stringify(got)}, очікувалось ${JSON.stringify(want)}`); }
  }
  // Поле вводу: вставлене посилання стає нікнеймом, а набір «instagram.com/» не стирається.
  const typing = [['https://www.instagram.com/vasiliinudik?vrfl=x', 'vasiliinudik'], ['instagram.com/', 'instagram.com/'], ['vasy', 'vasy']];
  for (const [raw, want] of typing) {
    const got = admin.igInputValue(raw);
    if (got !== want) { failed++; console.error(`FAIL [input] ${JSON.stringify(raw)} → ${JSON.stringify(got)}, очікувалось ${JSON.stringify(want)}`); }
  }
  const total = CASES.length * 2 + SEARCH_CASES.length + typing.length;
  if (failed) { console.error(`\n${failed} з ${total} перевірок не пройшли`); process.exit(1); }
  console.log(`OK: усі ${total} перевірок пройшли`);
})();
