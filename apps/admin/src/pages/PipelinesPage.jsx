// §9.6 Воронки (Pipeline/Stages) — 2026-09-05: список усіх воронок зверху (назва + стадії +
// к-сть замовлень), клік вибирає воронку для редагування стадій нижче; кнопка "+ Воронка"
// завжди видима (раніше зʼявлялась лише коли воронок уже >1 — незручно створити другу).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, Input, Card, ErrorBanner, EmptyState, Badge } from '../components/common/Common';

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [error, setError] = useState('');
  const [newStageName, setNewStageName] = useState('');

  async function load() {
    setError('');
    try {
      const { data } = await api.listPipelines();
      setPipelines(data);
      setCurrentId((prev) => prev && data.some((p) => p.id === prev) ? prev : data[0]?.id || null);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  const current = pipelines?.find((p) => p.id === currentId);

  async function addStage() {
    if (!newStageName.trim() || !current) return;
    try { await api.createStage(current.id, { name: newStageName.trim() }); setNewStageName(''); load(); } catch (e) { alert(e.message); }
  }
  async function renameStage(stage) {
    const name = prompt('Нова назва стадії', stage.name);
    if (!name || name === stage.name) return;
    try { await api.updateStage(stage.id, { name }); load(); } catch (e) { alert(e.message); }
  }
  async function deleteStage(stage) {
    if (!confirm(`Видалити стадію «${stage.name}»?`)) return;
    try { await api.deleteStage(stage.id); load(); } catch (e) { alert(e.message); }
  }
  async function moveStage(stage, dir) {
    try { await api.updateStage(stage.id, { order: stage.order + dir }); load(); } catch (e) { alert(e.message); }
  }
  async function createPipeline() {
    const name = prompt('Назва нової воронки');
    if (!name) return;
    try { const { data } = await api.createPipeline({ name }); await load(); setCurrentId(data.id); } catch (e) { alert(e.message); }
  }
  async function renamePipeline(p) {
    const name = prompt('Нова назва воронки', p.name);
    if (!name || name === p.name) return;
    try { await api.updatePipeline(p.id, { name }); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Воронки" action={<Button onClick={createPipeline}>+ Воронка</Button>} />
      <ErrorBanner message={error} />

      {pipelines !== null && pipelines.length === 0 && <EmptyState title="Воронок ще немає" action={<Button onClick={createPipeline}>+ Воронка</Button>} />}

      {pipelines && pipelines.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {pipelines.map((p) => {
            const ordersTotal = p.stages.reduce((s, st) => s + (st.ordersCount || 0), 0);
            return (
              <Card
                key={p.id}
                className={`cursor-pointer p-4 ${p.id === currentId ? 'border-brand' : 'hover:border-slate-700'}`}
                onClick={() => setCurrentId(p.id)}
              >
                <div className="mb-1 flex items-center justify-between">
                  <button onClick={(e) => { e.stopPropagation(); renamePipeline(p); }} className="text-left text-sm font-semibold hover:text-brand-light">{p.name}</button>
                  {p.id === currentId && <Badge color="teal">Обрана</Badge>}
                </div>
                <div className="text-xs text-slate-500">{p.stages.length} стадій · {ordersTotal} замовлень</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.stages.slice(0, 6).map((s) => <Badge key={s.id}>{s.name}</Badge>)}
                  {p.stages.length > 6 && <Badge>+{p.stages.length - 6}</Badge>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {current && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-300">Стадії воронки «{current.name}»</h3>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {current.stages.map((stage, i) => (
              <Card key={stage.id} className="w-64 shrink-0 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <button onClick={() => renameStage(stage)} className="text-left text-sm font-medium hover:text-brand-light">{stage.name}</button>
                  <button onClick={() => deleteStage(stage)} className="text-slate-500 hover:text-red-400">🗑️</button>
                </div>
                <div className="text-xs text-slate-500">{stage.ordersCount} замовлень</div>
                <div className="mt-2 flex gap-1">
                  <button disabled={i === 0} onClick={() => moveStage(stage, -1)} className="rounded bg-slate-800 px-2 py-0.5 text-xs disabled:opacity-30">←</button>
                  <button disabled={i === current.stages.length - 1} onClick={() => moveStage(stage, 1)} className="rounded bg-slate-800 px-2 py-0.5 text-xs disabled:opacity-30">→</button>
                </div>
              </Card>
            ))}
            <Card className="flex w-64 shrink-0 flex-col justify-center gap-2 p-3">
              <Input placeholder="Назва стадії" value={newStageName} onChange={(e) => setNewStageName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStage()} />
              <Button variant="secondary" onClick={addStage}>+ Стадія</Button>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
