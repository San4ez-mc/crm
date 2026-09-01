import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/authStore';

const SECTIONS = [
  { title: 'Каталог', items: [
    { to: '/products', label: 'Товари' },
    { to: '/sets', label: 'Комплекти' },
    { to: '/categories', label: 'Категорії' },
    { to: '/suppliers', label: 'Постачальники' },
  ] },
  { title: 'Продажі', items: [
    { to: '/pipelines', label: 'Воронки' },
    { to: '/orders', label: 'Замовлення' },
    { to: '/buyers', label: 'Покупці' },
    { to: '/returns', label: 'Повернення/обміни' },
  ] },
  { title: 'Реклама та аналітика', items: [
    { to: '/analytics', label: 'Дашборд аналітики' },
    { to: '/daily-analytics', label: 'Щоденна аналітика' },
    { to: '/ads', label: 'Оголошення' },
    { to: '/ad-spend', label: 'Рекламні витрати' },
  ] },
  { title: 'Фінанси', items: [
    { to: '/payments', label: 'Журнал платежів' },
    { to: '/product-expenses', label: 'Витрати по товару' },
  ] },
  { title: 'Налаштування', items: [
    { to: '/settings/general', label: 'Загальні' },
    { to: '/automations', label: 'Автоматизації' },
  ] },
];

function linkClass({ isActive }) {
  return clsx(
    'block rounded-lg px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-brand/15 text-brand-light font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
  );
}

// mobileOpen/onClose — off-canvas drawer на вузьких екранах (<768px); на md+ це
// звичайний статичний сайдбар (властивості ігноруються, завжди видимий).
export default function Sidebar({ mobileOpen = false, onClose = () => {} }) {
  const { user, tenants, currentTenantId, setTenant, logout } = useAuthStore();

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={onClose} />
      )}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 transition-transform duration-200 md:static md:z-auto md:w-52 md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧾</span>
            <span className="font-semibold tracking-tight">Fineko CRM</span>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-100 md:hidden" aria-label="Закрити меню">✕</button>
        </div>

        {tenants.length > 1 && (
          <div className="px-3 py-3 border-b border-slate-800">
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none"
              value={currentTenantId || ''}
              onChange={(e) => { setTenant(e.target.value); window.location.reload(); }}
            >
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{section.title}</div>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavLink key={item.to} to={item.to} className={linkClass} onClick={onClose}>{item.label}</NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800 px-4 py-3">
          <div className="truncate text-xs text-slate-500">{user?.email}</div>
          <button onClick={logout} className="mt-1 text-xs text-slate-400 hover:text-slate-200">Вийти</button>
        </div>
      </aside>
    </>
  );
}
