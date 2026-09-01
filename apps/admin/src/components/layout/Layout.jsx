// Мобільна версія: сайдбар — off-canvas drawer, що виїжджає поверх контенту
// (не звужує його) з бекдропом; на md+ — звичайний статичний сайдбар, як і був.
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);

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

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
