// 2026-11-06 (Олексій, Edits: «прибрати «Не відписали протягом доби» та «Скасовано» — вони непотрібні»).
// «Скасовані» тепер просто видалені замовлення (Order.deletedAt): замовлення зі стадії «Скасовано» м'яко видаляються (зникають зі списку й
// зі звітів, у базі лишаються) і переносяться на першу стадію воронки, щоб стадію можна було прибрати. Картки зі стадії «Не відписали…»
// (розмови без відповіді) переносяться на першу стадію. Потім обидві стадії видаляються з усіх воронок усіх магазинів.
// Без --apply — лише показує, що буде зроблено. Повторний запуск безпечний.
// Запуск: node scripts/remove-unused-stages.js [--apply]
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { db } = require('../packages/db');

const APPLY = process.argv.includes('--apply');
const CANCELLED = 'Скасовано';
const IDLE = 'Не відписали протягом доби';

(async () => {
  const stages = await db.stage.findMany({
    where: { name: { in: [CANCELLED, IDLE] } },
    include: { pipeline: { include: { stages: { orderBy: { order: 'asc' } } } }, _count: { select: { orders: true } } },
  });
  if (!stages.length) { console.log('Цих стадій уже нема. Нічого робити.'); return; }
  for (const s of stages) {
    const first = s.pipeline.stages.find((x) => x.id !== s.id);
    console.log(`Магазин ${s.pipeline.tenantId.slice(0, 8)} · «${s.name}» · замовлень: ${s._count.orders} → ${s.name === CANCELLED ? 'м\'яко видалити' : 'перенести'} на «${first ? first.name : '—'}», стадію прибрати`);
    if (!APPLY) continue;
    if (s._count.orders > 0) {
      if (!first) { console.log('  пропущено: у воронці нема іншої стадії'); continue; }
      await db.order.updateMany({
        where: { stageId: s.id },
        data: { stageId: first.id, ...(s.name === CANCELLED ? { deletedAt: new Date(), deletedBy: 'міграція: стадія «Скасовано» прибрана' } : {}) },
      });
    }
    await db.stage.delete({ where: { id: s.id } });
    console.log('  готово');
  }
  if (!APPLY) console.log('\nСухий прогін. Додайте --apply.');
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); }).finally(() => db.$disconnect());
