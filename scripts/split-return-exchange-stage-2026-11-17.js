'use strict';
// 2026-11-17 (Edits edbaa3ea, Олексій): стадію «Повернення/обмін» розділено — «Повернення» (лише повернення) і «Обмін» (окрема колонка).
// Бот реєструє тип (return | exchange) — POST /returns рухає картку у відповідну колонку. Скрипт: перейменовує «Повернення/обмін» → «Повернення»
// і додає «Обмін» одразу після неї, у воронках магазину, де стадії «Обмін» ще нема. Без --apply лише показує.
//   node scripts/split-return-exchange-stage-2026-11-17.js [--tenant=goverla_shop] [--apply]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../packages/db');
const arg = (n, d) => ((process.argv.find((a) => a.startsWith('--' + n + '=')) || '').slice(n.length + 3)) || d;
const APPLY = process.argv.includes('--apply');
(async () => {
  const tenant = await db.tenant.findFirst({ where: { name: arg('tenant', 'goverla_shop') }, select: { id: true, name: true } });
  if (!tenant) throw new Error('Магазин не знайдено');
  const pipelines = await db.pipeline.findMany({ where: { tenantId: tenant.id }, include: { stages: { orderBy: { order: 'asc' } } } });
  for (const p of pipelines) {
    const ret = p.stages.find((s) => /^повернення(\/обмін)?$/i.test(String(s.name).trim()));
    const exch = p.stages.find((s) => /^обмін$/i.test(String(s.name).trim()));
    if (!ret) { console.log(`воронка «${p.name}»: стадії «Повернення/обмін» нема — пропуск`); continue; }
    console.log(`воронка «${p.name}»: «${ret.name}» (порядок ${ret.order}) → «Повернення»${exch ? '; «Обмін» уже є' : '; додаю «Обмін» після неї'}`);
    if (!APPLY) continue;
    if (ret.name !== 'Повернення') await db.stage.update({ where: { id: ret.id }, data: { name: 'Повернення' } });
    if (!exch) {
      // зсуваємо наступні стадії на 1 і ставимо «Обмін» одразу після «Повернення»
      await db.stage.updateMany({ where: { pipelineId: p.id, order: { gt: ret.order } }, data: { order: { increment: 1 } } });
      await db.stage.create({ data: { pipelineId: p.id, name: 'Обмін', order: ret.order + 1, countsAsOrder: ret.countsAsOrder } });
    }
  }
  console.log(APPLY ? 'Застосовано' : 'Сухий прогін. Додайте --apply.');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); }).finally(() => db.$disconnect());
