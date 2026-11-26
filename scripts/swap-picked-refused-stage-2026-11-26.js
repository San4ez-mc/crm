'use strict';
// 26.11 (Edits 600dc920, Олексій: «Клієнт забрав на пошті краще щоб було перед Клієнт відмовився на пошті»): у воронках усіх магазинів
// стадія «Клієнт забрав на пошті» стає перед «Не забрав на пошті». Переносу замовлень не робить: статуси НП рухаються за НАЗВАМИ стадій.
// Запуск: node scripts/swap-picked-refused-stage-2026-11-26.js          — лише показати
//         node scripts/swap-picked-refused-stage-2026-11-26.js --apply  — поміняти місцями
const path = require('path');
require(path.join(__dirname, '..', 'node_modules', 'dotenv')).config({ path: path.join(__dirname, '..', '.env') });
const { db } = require(path.join(__dirname, '..', 'packages', 'db'));

(async () => {
  const apply = process.argv.includes('--apply');
  const pipelines = await db.pipeline.findMany({ include: { stages: true, tenant: { select: { name: true } } } });
  for (const p of pipelines) {
    const picked = p.stages.find((s) => /клієнт\s+забрав/i.test(s.name));
    const refused = p.stages.find((s) => /не\s+забрав/i.test(s.name));
    if (!picked || !refused || picked.order < refused.order) continue;
    console.log(`${p.tenant?.name}: «${picked.name}» ${picked.order} ↔ «${refused.name}» ${refused.order}`);
    if (!apply) continue;
    await db.$transaction([
      db.stage.update({ where: { id: picked.id }, data: { order: -1 } }),
      db.stage.update({ where: { id: refused.id }, data: { order: picked.order } }),
      db.stage.update({ where: { id: picked.id }, data: { order: refused.order } }),
    ]);
    console.log('  поміняно');
  }
  await db.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
