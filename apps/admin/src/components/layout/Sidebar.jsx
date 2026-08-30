import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/authStore';

const SECTIONS = [
  { title: 'Каталог', items: [
    { to: '/products', label: 'Товари' },
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
    { to: '/ad-spend', label: 'Рекламні витрати' },
  ] },
  { title: 'Фінанси', items: [
    { to: '/payments', label: 'Журнал платежів' },
    { to: '/product-expenses', label: 'Витрати по товару' },
  ] },
  { title: 'Налаштування', items: [
    { to: '/settings/general', label: 'Загальні' },
    { to: '/settings/integrations', label: 'Інтеграції' },
  ] },
];

function linkClass({ isActive }) {
  return clsx(
    'block rounded-lg px-3 py-2 text-sm transition-colors',
    isActive ? 'bg-brand/15 text-brand-light font-medium' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
  );
}

export default function Sidebar() {
  const { user, tenants, currentTenantId, setTenant, logout } = useAuthStore();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 px-4 py-4 border-b border-slate-800">
        <span className="text-xl">🧾</span>
        <span className="font-semibold tracking-tight">Fineko CRM</span>
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
                <NavLink key={item.to} to={item.to} className={linkClass}>{item.label}</NavLink>
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
  );
}
