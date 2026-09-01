// Дрібні спільні елементи, щоб не дублювати класи по сторінках.
export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
      <span>Всього: {total}</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-30 hover:bg-slate-800">← Назад</button>
        <span>Сторінка {page} з {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-30 hover:bg-slate-800">Далі →</button>
      </div>
    </div>
  );
}

export function PageHeader({ title, action }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h1 className="text-lg font-semibold text-slate-100">{title}</h1>
      {action}
    </div>
  );
}

export function Button({ children, variant = 'primary', ...props }) {
  const styles = {
    primary: 'bg-brand hover:bg-brand-dark text-white',
    secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
    danger: 'bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-900/60',
  };
  return (
    <button {...props} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${styles[variant]} ${props.className || ''}`}>
      {children}
    </button>
  );
}

export function IconButton({ children, ...props }) {
  return (
    <button {...props} className={`flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white ${props.className || ''}`}>
      {children}
    </button>
  );
}

export function Input(props) {
  return <input {...props} className={`w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none ${props.className || ''}`} />;
}

export function Textarea(props) {
  return <textarea {...props} className={`w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-brand focus:outline-none ${props.className || ''}`} />;
}

export function Select({ children, ...props }) {
  return <select {...props} className={`w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-brand focus:outline-none ${props.className || ''}`}>{children}</select>;
}

export function Label({ children }) {
  return <label className="mb-1 block text-xs font-medium text-slate-400">{children}</label>;
}

export function Field({ label, children }) {
  return (
    <div className="mb-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// overflow-x-auto тут — щоб широкі таблиці скролились ГОРИЗОНТАЛЬНО всередині картки
// на мобільних, а не ламали всю сторінку (мобільна верстка, 2026-09-01).
export function Card({ children, className = '' }) {
  return <div className={`overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 ${className}`}>{children}</div>;
}

export function Badge({ children, color = 'slate' }) {
  const colors = {
    slate: 'bg-slate-800 border-slate-700 text-slate-300',
    teal: 'bg-teal-900/30 border-teal-800/50 text-teal-300',
    red: 'bg-red-900/30 border-red-800/50 text-red-300',
    amber: 'bg-amber-900/30 border-amber-800/50 text-amber-300',
    green: 'bg-emerald-900/30 border-emerald-800/50 text-emerald-300',
  };
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${colors[color]}`}>{children}</span>;
}

export function EmptyState({ title, hint, action }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="text-slate-300">{title}</div>
      {hint && <div className="max-w-sm text-sm text-slate-500">{hint}</div>}
      {action}
    </Card>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return <div className="mb-4 rounded-lg border border-red-900/60 bg-red-900/20 px-3 py-2 text-sm text-red-300">{message}</div>;
}

export function money(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;
}
