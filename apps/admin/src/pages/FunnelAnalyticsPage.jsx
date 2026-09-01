// Аналітика конверсії по етапах воронки. Джерело даних — нода "Етап воронки" (funnelStage)
// у Flows: кожна воронка сама вирішує, які етапи й у якому порядку відправляти, тому список
// етапів тут повністю залежить від того, що реально прийшло з funnelEvent-подій.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Select, Card, EmptyState, ErrorBanner } from '../components/common/Common';

export default function FunnelAnalyticsPage() {
  const [funnels, setFunnels] = useState([]);
  const [funnelSlug, setFunnelSlug] = useState('');
  const [stages, setStages] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listFunnelSlugs().then(({ data }) => { setFunnels(data); if (data.length && !funnelSlug) setFunnelSlug(data[0]); }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setError('');
    api.getFunnelSummary(funnelSlug ? { funnelSlug } : {}).then(({ data }) => setStages(data)).catch((e) => setError(e.message));
  }, [funnelSlug]);

  const maxSessions = Math.max(1, ...(stages || []).map((s) => s.sessions));

  return (
    <div>
      <PageHeader title="Воронка (конверсія по етапах)" />
      <ErrorBanner message={error} />
      <p className="mb-4 max-w-2xl text-sm text-slate-400">
        Дані надходить з ноди «Етап воронки» у Flows — кожна воронка сама визначає свої контрольні
        точки. Тут — скільки унікальних розмов дійшло до кожної, і скільки відсіялось між кроками.
      </p>

      {funnels.length > 1 && (
        <div className="mb-4">
          <Select className="max-w-xs" value={funnelSlug} onChange={(e) => setFunnelSlug(e.target.value)}>
            {funnels.map((f) => <option key={f} value={f}>{f}</option>)}
          </Select>
        </div>
      )}

      {stages === null ? null : stages.length === 0 ? (
        <EmptyState title="Даних ще немає" hint="Додайте ноду «Етап воронки» у Flows на потрібних кроках — дані з'являться після перших розмов." />
      ) : (
        <Card className="p-5">
          <div className="space-y-3">
            {stages.map((s, i) => (
              <div key={s.stageName}>
                <div className="mb-1 flex items-baseline justify-between text-sm">
                  <span className="font-medium">{i + 1}. {s.stageName}</span>
                  <span className="text-slate-400">
                    {s.sessions} {i > 0 && s.convFromPrev !== null && (
                      <span className="ml-2 text-xs">
                        ({s.convFromPrev}% від попереднього{i > 1 ? `, ${s.convFromFirst}% від старту` : ''})
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-6 w-full overflow-hidden rounded-md bg-slate-800">
                  <div
                    className="h-full rounded-md bg-brand transition-all"
                    style={{ width: `${Math.max(4, (s.sessions / maxSessions) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
