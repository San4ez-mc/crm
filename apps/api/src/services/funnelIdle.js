// Крон «Не відписали протягом доби» (2026-09-09, власник): картки розмов воронки, які стоять на стадіях ДО
// «Замовлення прийняте» і від останньої події клієнта (Order.lastClientAt) минуло ≥ 24 год, переводимо на окрему
// стадію «Не відписали протягом доби» (створюється в кожному pipeline, якщо її нема). Коли клієнт повертається —
// нова подія воронки (POST /funnel-events) ставить картку назад на свою стадію.
const { db } = require('@crm/db');
const logger = require('@crm/logger');

const IDLE_STAGE_NAME = 'Не відписали протягом доби';
const IDLE_MS = 24 * 3600 * 1000;
const FINAL_RE = /замовлення прийняте|оформлене в постачальника|повернення|обмін|не відписали/i;

async function ensureIdleStage(pipeline) {
  const hit = pipeline.stages.find((s) => /не відписали/i.test(String(s.name || '')));
  if (hit) return hit;
  const maxOrder = pipeline.stages.reduce((m, s) => Math.max(m, Number(s.order) || 0), -1);
  const created = await db.stage.create({ data: { pipelineId: pipeline.id, name: IDLE_STAGE_NAME, order: maxOrder + 1 } });
  logger.info('[funnelIdle] created stage', { pipelineId: pipeline.id, stageId: created.id });
  return created;
}

async function runFunnelIdleSweep() {
  try {
    const pipelines = await db.pipeline.findMany({ include: { stages: true } });
    const cutoff = new Date(Date.now() - IDLE_MS);
    let moved = 0;
    for (const p of pipelines) {
      const idle = await ensureIdleStage(p);
      const preOrderStageIds = p.stages.filter((s) => s.id !== idle.id && !FINAL_RE.test(String(s.name || ''))).map((s) => s.id);
      if (!preOrderStageIds.length) continue;
      const r = await db.order.updateMany({
        where: { tenantId: p.tenantId, funnelSessionId: { not: null }, stageId: { in: preOrderStageIds }, OR: [{ lastClientAt: { lt: cutoff } }, { lastClientAt: null, updatedAt: { lt: cutoff } }] },
        data: { stageId: idle.id },
      });
      moved += r.count;
    }
    if (moved) logger.info('[funnelIdle] moved to idle stage', { moved });
  } catch (e) { logger.warn('[funnelIdle] sweep error: ' + e.message); }
}

function startFunnelIdleCron() {
  setTimeout(() => { runFunnelIdleSweep(); setInterval(runFunnelIdleSweep, 30 * 60 * 1000); }, 60 * 1000);
}

module.exports = { startFunnelIdleCron, runFunnelIdleSweep, IDLE_STAGE_NAME };
