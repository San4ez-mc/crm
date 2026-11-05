// 2026-11-05 (власник): окремий магазин для замовлень з лендінгу, з тією ж воронкою (стадіями), що в goverla_shop.
// Створює Tenant + копію першої воронки джерела (назви й порядок стадій — стадії зіставляються за НАЗВОЮ, тож синхронізація Нової пошти
// й звіти працюватимуть однаково) + відкритий ключ для лендінгу. Повторний запуск нічого не дублює (шукає магазин за назвою).
// Без --apply — лише показує, що буде. Запуск: node scripts/create-landing-shop.js [--apply] [--from goverla_shop] [--name "goverla_landing"]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { db } = require('../packages/db');

const APPLY = process.argv.includes('--apply');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg('--from', 'goverla_shop');
const NAME = arg('--name', 'goverla_landing');

(async () => {
  const src = await db.tenant.findFirst({ where: { name: FROM } });
  if (!src) throw new Error(`Магазин-джерело «${FROM}» не знайдено`);
  const pipe = await db.pipeline.findFirst({ where: { tenantId: src.id }, orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { order: 'asc' } } } });
  if (!pipe) throw new Error('У джерела немає воронки');
  console.log(`Джерело: ${src.name}, воронка «${pipe.name}», стадій: ${pipe.stages.length}`);
  console.log(pipe.stages.map((s) => `  ${s.order}. ${s.name}`).join('\n'));

  const existing = await db.tenant.findFirst({ where: { name: NAME } });
  if (existing) console.log(`Магазин «${NAME}» уже є (${existing.id}) — нове не створюю`);
  if (!APPLY) { console.log('\nСухий прогін. Додайте --apply, щоб створити.'); return; }

  const tenant = existing || await db.tenant.create({
    data: {
      name: NAME,
      // Налаштування, що впливають на замовлення, беремо з джерела: передоплата, курс, відсотки прогнозу.
      prepaymentAmount: src.prepaymentAmount, expectedRefusalPct: src.expectedRefusalPct,
      forecastRefusalPct: src.forecastRefusalPct, forecastReturnPct: src.forecastReturnPct,
      novaPoshtaApiKey: src.novaPoshtaApiKey,
    },
  });
  const hasPipe = await db.pipeline.count({ where: { tenantId: tenant.id } });
  if (!hasPipe) {
    await db.pipeline.create({ data: { tenantId: tenant.id, name: pipe.name, stages: { create: pipe.stages.map((s) => ({ name: s.name, order: s.order })) } } });
    console.log('Воронку скопійовано');
  }
  const key = tenant.publicKey || 'pk_' + crypto.randomUUID().replace(/-/g, '');
  if (!tenant.publicKey) await db.tenant.update({ where: { id: tenant.id }, data: { publicKey: key } });
  console.log(`\nГотово. Магазин: ${tenant.name} (${tenant.id})\nВідкритий ключ для лендінгу: ${key}`);
  console.log('Дати доступ менеджерам до цього магазину — у SSO-панелі (сторінка «Доступи»).');
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => db.$disconnect());
