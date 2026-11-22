'use strict';
// 2026-11-21 (правки Олексія 20.11: ba75e786, 364ccda5, 48be8778, 904320af; рішення власника — «у категоріях, де заповнюються питання бота, з умовами»):
// категорія «Унісекс костюми»: спершу питаємо, для кого костюм. Чоловік — зріст і вага, як завжди. Жінка — одне повідомлення з чотирма числами
// (зріст, груди, талія, стегна), розмір — за таблицею; різниця між найменшим і найбільшим розміром ≥ 2 → штани й кофта окремо.
// Таблиця — остання від Олексія (значення, що повторювались у двох розмірах, віддані меншому). Без --apply лише показує.
//   node scripts/create-unisex-category-2026-11-21.js [--tenant=goverla_shop] [--apply]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../packages/db');
const { normalizeQuestionFlow } = require('../apps/api/src/lib/questionFlow');
const arg = (n, d) => ((process.argv.find((a) => a.startsWith('--' + n + '=')) || '').slice(n.length + 3)) || d;
const APPLY = process.argv.includes('--apply');

const FLOW = {
  questions: [
    { id: 'gender', kind: 'options', ask: 'Підкажіть, будь ласка, костюм дивитесь на чоловіка чи на дівчину?',
      options: [
        { value: 'чоловік', aliases: ['чоловіка', 'чоловіку', 'чоловічий', 'чоловіча', 'хлопця', 'хлопець', 'хлопцю', 'мужчина', 'мужчину', 'муж', 'мужу', 'для себе', 'мені', 'він', 'для нього', 'братові', 'татові', 'тату', 'сину'] },
        { value: 'жінка', aliases: ['жінку', 'жінці', 'жіночий', 'жіноча', 'дівчину', 'дівчина', 'дівчині', 'дівчинку', 'дружині', 'дружину', 'мамі', 'маму', 'сестрі', 'доньці', 'для неї', 'вона', 'девушку', 'женщину'] },
      ] },
    { id: 'man', kind: 'legacy', showIf: { question: 'gender', in: ['чоловік'] } },
    { id: 'measures', kind: 'numbers', showIf: { question: 'gender', in: ['жінка'] },
      fields: ['Зріст', 'Обʼєм грудей', 'Обʼєм талії', 'Обʼєм стегон'],
      ask: 'Напишіть, будь ласка, наступні параметри жінки:\n\n1) Зріст жінки\n2) Обʼєм грудей\n3) Обʼєм талії\n4) Обʼєм стегон\n\nУ відповідь напишіть тільки 4 цифри через пробіл.\nБез «см.», тире, інших слів або позначень!\n\nВірно: «172 95 67 96» ✅\nНевірно: «172-95-67-96» ❌\nНевірно: «95см 67см. 96 см. 172 см» ❌' },
  ],
  sizing: {
    when: { question: 'gender', in: ['жінка'] }, from: 'measures',
    params: [{ key: 'bust', field: 'Обʼєм грудей' }, { key: 'waist', field: 'Обʼєм талії' }, { key: 'hips', field: 'Обʼєм стегон' }],
    chart: [
      { size: 'S', ranges: { bust: [86, 94], waist: [64, 74], hips: [90, 96] } },
      { size: 'M', ranges: { bust: [95, 100], waist: [75, 80], hips: [97, 102] } },
      { size: 'L', ranges: { bust: [101, 108], waist: [81, 86], hips: [103, 108] } },
      { size: 'XL', ranges: { bust: [109, 116], waist: [87, 94], hips: [109, 112] } },
      { size: 'XXL', ranges: { bust: [117, 124], waist: [95, 100], hips: [113, 116] } },
    ],
    rule: {
      splitSpread: 2, top: ['bust'], bottom: ['waist', 'hips'],
      okText: 'Дякую! За вашими параметрами рекомендую розмір {size} 📏',
      splitText: 'Штани рекомендую розмір «{bottom}», кофту рекомендую розмір «{top}» 📏\n\nКостюм не розпаровується — тому пропоную взяти окремо штани та окремо кофту різних кольорів.\nМожна також взяти кофту та штани одного кольору, різних розмірів, але у такому випадку відтінок кофти та штанів можуть трохи відрізнятись.',
    },
  },
};

(async () => {
  const tenant = await db.tenant.findFirst({ where: { name: arg('tenant', 'goverla_shop') }, select: { id: true, name: true } });
  if (!tenant) throw new Error('Магазин не знайдено');
  const flow = normalizeQuestionFlow(FLOW);
  const existing = await db.category.findFirst({ where: { tenantId: tenant.id, name: 'Унісекс костюми' } });
  console.log(`«${tenant.name}»: категорія «Унісекс костюми» ${existing ? 'вже є — оновлю питання' : 'буде створена'}; питань ${flow.questions.length}, розмірів у таблиці ${flow.sizing.chart.length}`);
  if (!APPLY) { console.log('Сухий прогін. Додайте --apply.'); return; }
  const data = { description: 'Костюми, що підходять чоловікам і жінкам: бот спершу питає, для кого, далі — зріст і вага (чоловік) або чотири обміри (жінка).',
    aiInstructions: 'Спершу з’ясуй, для кого костюм (чоловік чи жінка). Для жінки розмір підбирається ЛИШЕ за обмірами (груди, талія, стегна), не за вагою.',
    requiredParams: [{ name: 'Зріст', unit: 'см', hint: '' }, { name: 'Вага', unit: 'кг', hint: '' }], synonyms: [], questionFlow: flow };
  if (existing) await db.category.update({ where: { id: existing.id }, data });
  else await db.category.create({ data: { tenantId: tenant.id, name: 'Унісекс костюми', ...data } });
  console.log('Готово');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); }).finally(() => db.$disconnect());
