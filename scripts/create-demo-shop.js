// 2026-11-06 (власник): ОДИН демо-магазин для показу Fineko CRM майбутнім клієнтам (бот Ден видає на нього спільний тестовий вхід).
// Створює Tenant «Fineko CRM Демо» без ключів Нової пошти й Meta (нічого зовнішнього не опитує) і наповнює його вигаданими даними:
// постачальники, категорії, товари з кольорами/розмірами і собівартістю, покупці, замовлення на всіх етапах воронки зі статусами ТТН,
// відмови, повернення, оплати, реклама з витратами по днях і привʼязкою до замовлень, база знань. Імена, телефони й адреси вигадані.
// Етапи воронки копіюються з goverla_shop (назви однакові → аналітика й картки виглядають як у бойовому магазині).
// Без --apply — лише показує план. Повторний запуск нічого не дублює (шукає магазин за назвою); --reseed видаляє ЛИШЕ замовлення/рекламу
// цього демо-магазину й створює їх заново зі свіжими датами (щоб «останні 14 днів» не старіли).
// Запуск: node scripts/create-demo-shop.js [--apply] [--reseed] [--from goverla_shop]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { db } = require('../packages/db');

const APPLY = process.argv.includes('--apply');
const RESEED = process.argv.includes('--reseed');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg('--from', 'goverla_shop');
// --preset clothes (за замовчуванням, «Fineko CRM Демо») | gadgets («Fineko CRM Демо 2: гаджети») — два різні за нішею демо-магазини для показу (06.11).
const PRESET = arg('--preset', 'clothes');
let NAME = 'Fineko CRM Демо';
let DESCRIPTION = 'Демо-магазин: Instagram-магазин одягу й аксесуарів, працює через постачальників (дані вигадані для показу CRM)';
let SKU_SET_OFFER = 'DEMO-SET1-1';

// Детермінований генератор, щоб дані були однакові між запусками.
let seed = 20261106;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const DAY = 86400000;
const daysAgo = (n, hour = 12) => { const d = new Date(Date.now() - n * DAY); d.setUTCHours(hour, int(0, 59), 0, 0); return d; };
const dateOnly = (n) => { const d = new Date(Date.now() - n * DAY); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

let CATEGORIES = [
  { name: 'Верхній одяг', description: 'Куртки, пуховики, вітровки' },
  { name: 'Худі та футболки', description: 'Повсякденний одяг' },
  { name: 'Взуття', description: 'Кросівки та черевики' },
  { name: 'Аксесуари', description: 'Сумки, ремені, шапки' },
];
let SUPPLIERS = [
  { name: 'BrewDrop (демо)', mechanism: 'BrewDrop', description: 'Дропшип-постачальник одягу. Дані вигадані для демонстрації.', website: 'https://example.com/brewdrop', telegramName: 'BrewDrop — замовлення (демо)', loginUsername: 'demo', loginPassword: 'demo', aiNotes: 'Відправляє за 1–2 дні. Розмірна сітка маломірить на розмір.' },
  { name: 'EasyDrop (демо)', mechanism: 'EasyDrop', description: 'Дропшип-постачальник взуття й аксесуарів. Дані вигадані.', website: 'https://example.com/easydrop', telegramName: 'EasyDrop — менеджер (демо)', loginUsername: 'demo', loginPassword: 'demo', aiNotes: 'Мінімальне замовлення — 1 пара. Повернення за свій рахунок.' },
  { name: 'Ручний постачальник (демо)', mechanism: 'Ручне оформлення', description: 'Оформлення на сайті постачальника вручну.', website: 'https://example.com/manual', aiNotes: 'Ціна змінюється раз на місяць.' },
];
// cat, supplier, name, sku, price, cogs, mgr%, sizes, colors, companionSku
let PRODUCTS = [
  { cat: 0, sup: 0, name: 'Куртка демісезонна', sku: 'DEMO-101', price: 2490, cogs: 1450, sizes: ['S', 'M', 'L', 'XL'], colors: ['Чорний', 'Оливковий', 'Графітовий'] },
  { cat: 0, sup: 0, name: 'Вітровка легка', sku: 'DEMO-102', price: 1390, cogs: 790, sizes: ['S', 'M', 'L', 'XL'], colors: ['Синій', 'Чорний'] },
  { cat: 1, sup: 0, name: 'Худі базове', sku: 'DEMO-201', price: 1190, cogs: 640, sizes: ['S', 'M', 'L', 'XL', 'XXL'], colors: ['Сірий', 'Чорний', 'Бежевий'] },
  { cat: 1, sup: 0, name: 'Футболка оверсайз', sku: 'DEMO-202', price: 590, cogs: 280, sizes: ['S', 'M', 'L', 'XL'], colors: ['Білий', 'Чорний'] },
  { cat: 2, sup: 1, name: 'Кросівки міські', sku: 'DEMO-301', price: 1990, cogs: 1180, sizes: ['40', '41', '42', '43', '44'], colors: ['Білий', 'Чорний'] },
  { cat: 3, sup: 1, name: 'Сумка через плече', sku: 'DEMO-401', price: 890, cogs: 430, sizes: [], colors: ['Чорний', 'Коричневий'] },
  { cat: 3, sup: 2, name: 'Ремінь шкіряний', sku: 'DEMO-402', price: 490, cogs: 210, sizes: [], colors: ['Чорний', 'Коричневий'] },
  { cat: 3, sup: 2, name: 'Шапка в рубчик', sku: 'DEMO-403', price: 390, cogs: 160, sizes: [], colors: ['Сірий', 'Чорний'] },
];
let SET = { name: 'Комплект: худі + футболка', sku: 'DEMO-SET1', price: 1590, cogs: 920, components: ['DEMO-201', 'DEMO-202'] };

const FIRST = ['Олена', 'Ірина', 'Андрій', 'Максим', 'Наталія', 'Олег', 'Тетяна', 'Віктор', 'Марина', 'Денис', 'Юлія', 'Сергій', 'Анна', 'Богдан', 'Ольга', 'Роман'];
const LAST = ['Коваленко', 'Бойко', 'Шевченко', 'Мельник', 'Ткаченко', 'Кравченко', 'Олійник', 'Гончар', 'Савчук', 'Руденко', 'Лисенко', 'Мороз'];
const CITIES = [['Київ', 'Відділення №12'], ['Львів', 'Відділення №5'], ['Одеса', 'Відділення №31'], ['Дніпро', 'Відділення №8'], ['Харків', 'Відділення №19'], ['Вінниця', 'Відділення №3'], ['Полтава', 'Відділення №7'], ['Івано-Франківськ', 'Відділення №2']];
const MANAGERS = ['Бот', 'Бот', 'Бот', 'Менеджер Олена', 'Менеджер Іван'];

let ADS = [
  { name: 'Куртка демісезонна · відео', campaign: 'Осінь: верхній одяг', prod: 'DEMO-101', media: 'video', spend: [260, 520] },
  { name: 'Худі базове · фото', campaign: 'Осінь: худі', prod: 'DEMO-201', media: 'image', spend: [180, 380] },
  { name: 'Кросівки міські · карусель', campaign: 'Взуття', prod: 'DEMO-301', media: 'image', spend: [220, 460] },
  { name: 'Сумка через плече · reels', campaign: 'Аксесуари', prod: 'DEMO-401', media: 'video', spend: [90, 210] },
  { name: 'Вітровка · фото', campaign: 'Осінь: верхній одяг', prod: 'DEMO-102', media: 'image', spend: [120, 260] },
  { name: 'Комплект худі + футболка', campaign: 'Комплекти', prod: 'DEMO-SET1', media: 'image', spend: [150, 300] },
];

let KNOWLEDGE = [
  { kind: 'faq', question: 'Скільки йде доставка?|Коли відправите?', answer: 'Відправляємо протягом 1–2 робочих днів. Нова пошта доставляє по Україні за 1–3 дні.' },
  { kind: 'faq', question: 'Чи можна обміняти розмір?|Не підійшов розмір', answer: 'Так, обмін або повернення протягом 14 днів. Зворотна доставка за рахунок покупця, якщо річ без браку.' },
  { kind: 'faq', question: 'Можна оплатити при отриманні?|Накладений платіж', answer: 'Так. Є два варіанти: повна оплата зараз або передоплата 200 грн, решта при отриманні.' },
  { kind: 'objection', question: 'Дорого|Є дешевше в іншому місці', answer: 'Шиємо з щільного матеріалу, який не сідає після прання. Є знижка за комплект (худі + футболка дешевше, ніж окремо).' },
];

if (PRESET === 'gadgets') {
  NAME = 'Fineko CRM Демо 2: гаджети';
  DESCRIPTION = 'Демо-магазин 2: дропшипінг гаджетів і аксесуарів для телефонів, працює через двох постачальників (дані вигадані для показу CRM)';
  SKU_SET_OFFER = 'DEMOG-SET1-1';
  CATEGORIES = [
    { name: 'Навушники та колонки', description: 'Бездротові навушники, портативні колонки' },
    { name: 'Зарядки та кабелі', description: 'Швидкі зарядки, павербанки, кабелі' },
    { name: 'Чохли та скло', description: 'Чохли й захисне скло під моделі телефонів' },
    { name: 'Розумні годинники', description: 'Смарт-годинники та браслети' },
  ];
  SUPPLIERS = [
    { name: 'TechDrop (демо)', mechanism: 'EasyDrop', description: 'Дропшип-постачальник електроніки. Дані вигадані для демонстрації.', website: 'https://example.com/techdrop', telegramName: 'TechDrop — замовлення (демо)', loginUsername: 'demo', loginPassword: 'demo', aiNotes: 'Відправляє в день замовлення до 15:00. Повернення лише гарантійні.' },
    { name: 'CaseHub (демо)', mechanism: 'BrewDrop', description: 'Чохли та аксесуари оптом. Дані вигадані.', website: 'https://example.com/casehub', telegramName: 'CaseHub — менеджер (демо)', loginUsername: 'demo', loginPassword: 'demo', aiNotes: 'Чохол під нову модель — 2–3 дні.' },
  ];
  PRODUCTS = [
    { cat: 0, sup: 0, name: 'Бездротові навушники Air', sku: 'DEMOG-101', price: 1290, cogs: 690, sizes: [], colors: ['Білий', 'Чорний'] },
    { cat: 0, sup: 0, name: 'Портативна колонка Mini', sku: 'DEMOG-102', price: 990, cogs: 520, sizes: [], colors: ['Чорний', 'Синій', 'Червоний'] },
    { cat: 1, sup: 0, name: 'Швидка зарядка 65W', sku: 'DEMOG-201', price: 690, cogs: 340, sizes: [], colors: ['Білий'] },
    { cat: 1, sup: 0, name: 'Павербанк 20000 mAh', sku: 'DEMOG-202', price: 1190, cogs: 640, sizes: [], colors: ['Чорний', 'Сірий'] },
    { cat: 2, sup: 1, name: 'Чохол силіконовий', sku: 'DEMOG-301', price: 290, cogs: 95, sizes: ['iPhone 13', 'iPhone 14', 'iPhone 15', 'Galaxy S23'], colors: ['Чорний', 'Прозорий', 'Бежевий'] },
    { cat: 2, sup: 1, name: 'Захисне скло 9H', sku: 'DEMOG-302', price: 190, cogs: 45, sizes: ['iPhone 13', 'iPhone 14', 'iPhone 15', 'Galaxy S23'], colors: ['Прозоре'] },
    { cat: 3, sup: 0, name: 'Смарт-годинник Pulse', sku: 'DEMOG-401', price: 1890, cogs: 1040, sizes: [], colors: ['Чорний', 'Сріблястий'] },
    { cat: 3, sup: 0, name: 'Фітнес-браслет Fit', sku: 'DEMOG-402', price: 790, cogs: 390, sizes: [], colors: ['Чорний', 'Рожевий'] },
  ];
  SET = { name: 'Комплект: навушники + зарядка', sku: 'DEMOG-SET1', price: 1790, cogs: 1030, components: ['DEMOG-101', 'DEMOG-201'], sizes: [], color: 'Білий' };
  ADS = [
    { name: 'Навушники Air · відео', campaign: 'Аудіо', prod: 'DEMOG-101', media: 'video', spend: [260, 520] },
    { name: 'Колонка Mini · reels', campaign: 'Аудіо', prod: 'DEMOG-102', media: 'video', spend: [120, 280] },
    { name: 'Павербанк 20000 · фото', campaign: 'Зарядки', prod: 'DEMOG-202', media: 'image', spend: [90, 210] },
    { name: 'Смарт-годинник Pulse · карусель', campaign: 'Годинники', prod: 'DEMOG-401', media: 'image', spend: [220, 440] },
    { name: 'Чохли · фото', campaign: 'Чохли', prod: 'DEMOG-301', media: 'image', spend: [60, 150] },
    { name: 'Комплект навушники + зарядка', campaign: 'Комплекти', prod: 'DEMOG-SET1', media: 'image', spend: [150, 300] },
  ];
  KNOWLEDGE = [
    { kind: 'faq', question: 'Яка гарантія?|Чи є гарантія', answer: 'На електроніку — 12 місяців гарантії. Чохли та скло гарантії не мають, але брак міняємо протягом 14 днів.' },
    { kind: 'faq', question: 'Скільки йде доставка?|Коли відправите?', answer: 'Відправляємо в день замовлення (до 15:00) або наступного дня. Нова пошта доставляє за 1–3 дні.' },
    { kind: 'faq', question: 'Чохол підійде на мою модель?|Є під мою модель', answer: 'Вкажіть модель телефону, і ми підберемо чохол та скло. Якщо моделі немає в наявності, повідомимо строк під замовлення.' },
    { kind: 'objection', question: 'Дорого|На Aliexpress дешевше', answer: 'Ми перевіряємо кожну партію, даємо гарантію 12 місяців і міняємо брак. Є знижка на комплект (навушники + зарядка).' },
  ];
}
// Стадії, які більше не використовуються (прибрані з воронки 06.11): у демо їх не створюємо і не заповнюємо.
const REMOVED_STAGES = ['Не відписали протягом доби', 'Скасовано'];

(async () => {
  const src = await db.tenant.findFirst({ where: { name: FROM } });
  if (!src) throw new Error(`Магазин-джерело «${FROM}» не знайдено`);
  const pipe = await db.pipeline.findFirst({ where: { tenantId: src.id }, orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { order: 'asc' } } } });
  if (!pipe) throw new Error('У джерела немає воронки');
  console.log(`Етапи беремо з «${src.name}»: ${pipe.stages.map((s) => s.name).join(' → ')}`);

  const existing = await db.tenant.findFirst({ where: { name: NAME } });
  console.log(existing ? `Демо-магазин уже є (${existing.id})${RESEED ? ', буде перезасіяно замовлення/рекламу' : ''}` : 'Демо-магазину ще нема, буде створено');
  if (!APPLY) { console.log('\nСухий прогін. Додайте --apply.'); return; }

  const tenant = existing || await db.tenant.create({
    data: {
      name: NAME, shopDescription: DESCRIPTION, isDemo: true, plan: 'ai', planEndsAt: null,
      prepaymentAmount: 200, expectedRefusalPct: 23, forecastRefusalPct: 20, forecastReturnPct: 3, usdExchangeRate: 41.5, usdExchangeRateUpdatedAt: new Date(),
      dailyFixedCosts: 800, dailyPayrollCosts: 700, shippingTerms: 'Відправка протягом 1–2 робочих днів',
      publicKey: 'pk_' + crypto.randomUUID().replace(/-/g, ''),
    },
  });
  const tid = tenant.id;

  let pipeline = await db.pipeline.findFirst({ where: { tenantId: tid }, include: { stages: true } });
  if (!pipeline) pipeline = await db.pipeline.create({ data: { tenantId: tid, name: pipe.name, stages: { create: pipe.stages.filter((s) => !REMOVED_STAGES.includes(s.name)).map((s) => ({ name: s.name, order: s.order })) } }, include: { stages: true } });
  // Демо-магазин: прапорець isDemo (оплата з нього створює нову компанію) і тариф 3 без дати закінчення — і для вже створеного раніше.
  await db.tenant.update({ where: { id: tid }, data: { isDemo: true, plan: 'ai', planEndsAt: null } });
  const stageByName = Object.fromEntries(pipeline.stages.map((s) => [s.name, s]));
  const S = (n) => stageByName[n] || pipeline.stages[0];

  // ── довідники (створюються один раз) ──
  const hasProducts = await db.product.count({ where: { tenantId: tid } });
  if (!hasProducts) {
    const cats = [];
    for (const c of CATEGORIES) cats.push(await db.category.create({ data: { tenantId: tid, ...c } }));
    const sups = [];
    for (const s of SUPPLIERS) sups.push(await db.supplier.create({ data: { tenantId: tid, ...s } }));
    const created = {};
    for (const p of PRODUCTS) {
      const prod = await db.product.create({ data: { tenantId: tid, name: p.name, customerName: p.name, sku: p.sku, price: p.price, categoryId: cats[p.cat].id, supplierId: sups[p.sup].id, supplierArticle: 'SUP-' + p.sku.slice(-3), sizes: p.sizes, alwaysAvailable: true, presentationText: `${p.name}. Ціна ${p.price} грн.` } });
      for (let i = 0; i < p.colors.length; i++) {
        await db.offer.create({ data: { productId: prod.id, sku: `${p.sku}-${i + 1}`, availableSizes: p.sizes, properties: [{ name: 'Колір', value: p.colors[i] }], sortOrder: i } });
      }
      await db.productExpense.create({ data: { tenantId: tid, productId: prod.id, cogs: p.cogs, managerCostPercent: 8, managerCostFixed: 0 } });
      created[p.sku] = prod;
    }
    const setProd = await db.product.create({ data: { tenantId: tid, name: SET.name, customerName: SET.name, sku: SET.sku, price: SET.price, categoryId: cats[1].id, supplierId: sups[0].id, isSet: true, sizes: SET.sizes || ['S', 'M', 'L', 'XL'], presentationText: `${SET.name}. Ціна ${SET.price} грн (дешевше, ніж окремо).` } });
    await db.offer.create({ data: { productId: setProd.id, sku: SKU_SET_OFFER, availableSizes: SET.sizes || ['S', 'M', 'L', 'XL'], properties: [{ name: 'Колір', value: SET.color || 'Сірий + білий' }], sortOrder: 0 } });
    await db.productExpense.create({ data: { tenantId: tid, productId: setProd.id, cogs: SET.cogs, managerCostPercent: 8, managerCostFixed: 0 } });
    for (let i = 0; i < SET.components.length; i++) await db.productSetComponent.create({ data: { parentProductId: setProd.id, componentProductId: created[SET.components[i]].id, qty: 1 } }).catch((e) => console.log('  (склад комплекту пропущено:', e.message.slice(0, 80) + ')'));
    for (const k of KNOWLEDGE) await db.knowledgeEntry.create({ data: { tenantId: tid, ...k, scope: 'shop', source: 'manual' } });
    console.log('Довідники створено: товарів', PRODUCTS.length + 1, ', постачальників', SUPPLIERS.length, ', записів бази знань', KNOWLEDGE.length);
  } else console.log('Довідники вже є');

  // ── замовлення й реклама (можна перезасіяти) ──
  if (RESEED || !(await db.order.count({ where: { tenantId: tid } }))) {
    if (RESEED) {
      await db.order.deleteMany({ where: { tenantId: tid } });
      await db.buyer.deleteMany({ where: { tenantId: tid } });
      await db.ad.deleteMany({ where: { tenantId: tid } });
    }
    const products = await db.product.findMany({ where: { tenantId: tid }, include: { offers: true, productExpense: true } });
    const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));
    const ads = [];
    for (let i = 0; i < ADS.length; i++) {
      const a = ADS[i];
      const ad = await db.ad.create({ data: { tenantId: tid, externalId: `demo-ad-${i + 1}`, name: a.name, productId: bySku[a.prod].id, campaignId: `demo-camp-${i + 1}`, campaignName: a.campaign, adAccountName: 'Демо-кабінет', effectiveStatus: 'ACTIVE', adCreatedAt: daysAgo(20 - i), mediaType: a.media, captionText: `${a.name}: демонстраційний текст оголошення` } });
      for (let d = 0; d < 14; d++) {
        const amount = int(a.spend[0], a.spend[1]);
        await db.adSpendDaily.create({ data: { adId: ad.id, date: dateOnly(d), amount, impressions: amount * int(18, 30), clicks: int(40, 140), conversations: int(2, 9) } });
      }
      ads.push(ad);
    }

    // розподіл етапів: більше свіжих «в роботі», старіші — вже забрали/відмови
    const plan = [
      ['Презентація товару', 3], ['Написав параметри та колір', 3], ['Очікуємо дані та оплату', 3], ['Замовлення прийняте', 3],
      ['Замовлення оформлене в постачальника', 3], ['Відправлено', 5], ['Посилка зберігається на пошті', 3], ['Не забрав на пошті', 3],
      ['Клієнт забрав на пошті', 12], ['Повернення/обмін', 2],
    ];
    const queue = plan.flatMap(([n, c]) => Array.from({ length: c }, () => n));
    let phoneN = 10; let orders = 0; let returns = 0;
    for (const stageName of queue) {
      const later = ['Відправлено', 'Посилка зберігається на пошті', 'Не забрав на пошті', 'Клієнт забрав на пошті', 'Повернення/обмін'].includes(stageName);
      const age = later ? int(4, 13) : int(0, 3);
      const full = `${pick(FIRST)} ${pick(LAST)}`;
      const phone = `38050999${String(phoneN++).padStart(4, '0')}`;
      const buyer = await db.buyer.create({ data: { tenantId: tid, fullName: full, phone, igUsername: 'demo_' + phone.slice(-4) } });
      const prod = pick(products.filter((p) => !p.isSet || rnd() < 0.3));
      const offer = pick(prod.offers);
      const size = prod.sizes.length ? pick(prod.sizes) : null;
      const color = (offer.properties[0] || {}).value;
      const qty = rnd() < 0.15 ? 2 : 1;
      const [city, branch] = pick(CITIES);
      const ad = rnd() < 0.7 ? pick(ads) : null;
      const manager = pick(MANAGERS);
      const placed = !['Презентація товару', 'Написав параметри та колір', 'Очікуємо дані та оплату'].includes(stageName);
      const hasTtn = later || stageName === 'Замовлення оформлене в постачальника';
      const ttn = hasTtn ? ['20450' + String(int(100000000, 999999999))] : [];
      const ttnStatus = {
        'Відправлено': `Відправлення прямує до м. ${city}.`, 'Посилка зберігається на пошті': 'Прибув у відділення', 'Не забрав на пошті': 'Відмова від отримання',
        'Клієнт забрав на пошті': 'Відправлення отримано', 'Повернення/обмін': 'Відправлення отримано', 'Замовлення оформлене в постачальника': 'Відправник самостійно створив цю накладну, але ще не надав до відправки',
      }[stageName] || null;
      const created = daysAgo(age);
      const partial = rnd() < 0.4;
      const order = await db.order.create({
        data: {
          tenantId: tid, buyerId: buyer.id, stageId: S(stageName).id, sourceName: 'Instagram', ttn, ttnStatus, ttnStatusAt: ttnStatus ? daysAgo(Math.max(age - 1, 0)) : null,
          isRefused: stageName === 'Не забрав на пошті', createdAt: created, placedAt: placed ? created : null, placedBy: placed ? manager : null,
          paymentType: partial ? 'partial' : 'full', prepaymentAmount: partial ? 200 : null,
          shipping: { city, branch, shippingService: 'Нова Пошта', recipientFullName: full, recipientPhone: phone },
          firstTouchAdId: ad ? ad.id : null, firstTouchAt: ad ? daysAgo(age + 1) : null, lastTouchAdId: ad ? ad.id : null, lastTouchAt: ad ? created : null,
          contactName: full, aiCostUsd: manager === 'Бот' ? Number((0.04 + rnd() * 0.11).toFixed(3)) : null,
          managerComment: rnd() < 0.2 ? 'Уточнити розмір перед відправкою' : null,
          items: { create: [{ productId: prod.id, offerId: offer.id, name: `${prod.name}. Артикул: ${prod.sku}`, price: prod.price, quantity: qty, supplierId: prod.supplierId, properties: [color ? { name: 'Колір', value: color } : null, size ? { name: 'Розмір', value: size } : null].filter(Boolean) }] },
        },
      });
      orders++;
      const amount = Number(prod.price) * qty;
      if (placed) {
        await db.payment.create({ data: { tenantId: tid, orderId: order.id, amount: partial ? 200 : amount, method: pick(['monobank', 'ibanoplata']), status: 'success', createdAt: created } });
      }
      if (stageName === 'Повернення/обмін') {
        await db.return.create({ data: { tenantId: tid, orderId: order.id, type: returns === 0 ? 'return' : 'exchange', reason: returns === 0 ? 'Не підійшов розмір' : 'Хочу інший колір', ttn: '20450' + String(int(100000000, 999999999)), exchangeFor: returns === 0 ? null : 'Чорний', status: returns === 0 ? 'confirmed' : 'new', source: 'bot' } });
        returns++;
      }
    }
    console.log(`Замовлень створено: ${orders}, оголошень: ${ads.length}, повернень: ${returns}`);
  } else console.log('Замовлення вже є (для оновлення дат: --reseed)');

  console.log(`\nГотово. Демо-магазин: ${NAME} (${tid})`);
  console.log('Дати доступ у SSO: продукт CRM, роль user, projectIds = цей id.');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); }).finally(() => db.$disconnect());
