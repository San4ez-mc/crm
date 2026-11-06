// Мобільна версія: сайдбар — off-canvas drawer, що виїжджає поверх контенту
// (не звужує його) з бекдропом; на md+ — звичайний статичний сайдбар, як і був.
import { useState } from 'react';
import { Outlet, Navigate, useLocation, Link } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuthStore } from '../../stores/authStore';
import { canSeePath, firstAllowedPath } from '../../lib/pageAccess';
import { planInfo, fmtEnd, daysWord } from '../../lib/plan';

// Нагадування про оплату зверху (2026-11-06): за 7 днів до кінця — жовте, після кінця — червоне, у демо-магазині — запрошення обрати тариф.
function PlanBanner() {
  const { tenants, currentTenantId } = useAuthStore();
  const location = useLocation();
  const tenant = tenants.find((t) => t.id === currentTenantId);
  const info = planInfo(tenant);
  if (location.pathname.startsWith('/billing')) return null;
  const isDemo = !!tenant?.isDemo;
  if (!isDemo && info.state !== 'soon' && info.state !== 'expired') return null;
  const tone = info.state === 'expired' ? 'border-red-800 bg-red-950/60 text-red-100' : isDemo ? 'border-sky-800 bg-sky-950/50 text-sky-100' : 'border-amber-700 bg-amber-950/60 text-amber-100';
  const text = isDemo
    ? 'Це демонстраційний магазин з вигаданими даними. Щоб отримати свій магазин, оберіть тариф.'
    : info.state === 'expired'
      ? `Тариф «${info.name}» закінчився ${fmtEnd(info.endsAt)}. Оплатіть, щоб не втратити доступ.`
      : `Тариф «${info.name}» закінчується через ${info.daysLeft} ${daysWord(info.daysLeft)} (${fmtEnd(info.endsAt)}). Не забудьте оплатити.`;
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${tone}`}>
      <span>{text}</span>
      <Link to="/billing" className="rounded-lg border border-current/40 px-3 py-1 text-xs font-medium hover:bg-white/10">{isDemo ? 'Обрати тариф' : 'Оплатити'}</Link>
    </div>
  );
}

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { role, pageIds } = useAuthStore();
  // Закритий розділ за прямим посиланням (напр. менеджер відкрив /analytics) — на перший дозволений; сервер теж відмовить.
  if (!canSeePath(location.pathname, { role, pageIds })) return <Navigate to={firstAllowedPath({ role, pageIds })} replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* мобільний topbar — лише на вузьких екранах */}
        <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-lg hover:bg-slate-800"
            aria-label="Відкрити меню"
          >
            ☰
          </button>
          <span className="text-lg">🧾</span>
          <span className="font-semibold tracking-tight">Fineko CRM</span>
        </div>

        <PlanBanner />

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
