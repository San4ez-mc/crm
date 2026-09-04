// Дрібні спільні елементи, щоб не дублювати класи по сторінках.

// Номери сторінок з "…" для великої кількості — завжди показує 1, останню, поточну±1.
function pageList(current, total) {
  const set = new Set([1, total, current - 1, current, current + 1]);
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}

// 2026-09-05: додано номери сторінок (клікабельні, не лише "Назад/Далі") — щоб можна було
// перейти одразу на будь-яку сторінку, а не гортати послідовно.
export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-400">
      <span>Всього: {total}</span>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-30 hover:bg-slate-800">←</button>
        {pageList(page, pages).map((n, i) => n === '…' ? (
          <span key={`e${i}`} className="px-1.5 text-slate-600">…</span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`min-w-[2.25rem] rounded-lg border px-2.5 py-1.5 ${n === page ? 'border-brand bg-brand/15 text-brand-light' : 'border-slate-700 hover:bg-slate-800'}`}
          >
            {n}
          </button>
        ))}
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-30 hover:bg-slate-800">→</button>
      </div>
    </div>
  );
}

// flex-wrap — без цього дії (кнопки/select у "action") на вузькому екрані просто вилазили
// за межі viewport і ставали недоступними (overflow-x-hidden на <main> ховає їх без скролу),
// замість того щоб перенестись на новий рядок під заголовком (2026-09-05).
export function PageHeader({ title, action }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
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

// KPI-картка з дельтою до попереднього періоду (2026-09-02, редизайн аналітики).
// deltaGood='up' — зростання зелене (виручка/маржа/прибуток), 'down' — зростання червоне
// (напр. рекламний бюджет як витрата: більше не завжди краще, тому '=' не фарбуємо взагалі).
export function KpiCard({ label, value, delta, deltaGood = 'up' }) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const colorClass = !hasDelta ? '' : deltaGood === 'neutral' ? 'text-slate-400' : (deltaGood === 'up' ? delta >= 0 : delta <= 0) ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
      {hasDelta && (
        <div className={`mt-1 text-xs ${colorClass}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% від попереднього періоду
        </div>
      )}
    </div>
  );
}

function fmtChartDate(v) {
  return new Date(v).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

// Легкий бар-чарт тренду по днях, без сторонніх бібліотек (той самий "чистими дівами" підхід,
// що й решта чартів у застосунку). Якщо в серії є і плюс, і мінус (напр. прибуток по днях) —
// бари ростуть від центральної нульової лінії вгору/вниз; якщо серія завжди ≥0 (напр. витрата) —
// звичайні стовпчики від низу.
export function TrendChart({ data, valueKey, labelKey = 'date', height = 112, formatValue = (v) => v, negativeColor = 'bg-red-500/70', positiveColor = 'bg-brand' }) {
  if (!data || !data.length) return null;
  const values = data.map((d) => Number(d[valueKey]) || 0);
  const hasNegative = values.some((v) => v < 0);
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div>
      <div className="relative flex items-stretch gap-0.5" style={{ height }}>
        {hasNegative && <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-slate-700" />}
        {data.map((d, i) => {
          const v = values[i];
          const positive = v >= 0;
          const pct = hasNegative ? (Math.abs(v) / maxAbs) * 50 : (Math.abs(v) / maxAbs) * 100;
          return (
            <div key={d[labelKey] ?? i} className="relative flex-1" title={`${fmtChartDate(d[labelKey])}: ${formatValue(v)}`}>
              <div
                className={`absolute inset-x-0 rounded-sm ${positive ? positiveColor : negativeColor}`}
                style={hasNegative ? { height: `${pct}%`, ...(positive ? { bottom: '50%' } : { top: '50%' }) } : { height: `${pct}%`, bottom: 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-600">
        <span>{fmtChartDate(data[0][labelKey])}</span>
        <span>{fmtChartDate(data[data.length - 1][labelKey])}</span>
      </div>
    </div>
  );
}

// Єдине форматування телефону (2026-09-05) — дані приходять у різних виглядах (з/без "+",
// з/без "38", "0..." замість "380...") залежно від того, звідки взявся Buyer (воронка/ручне
// створення/KeyCRM-міграція); показуємо всюди однаково: +380 XX XXX XX XX.
export function formatPhone(phone) {
  if (!phone) return '—';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '380' + digits.slice(1);
  else if (!digits.startsWith('380') && digits.length === 9) digits = '380' + digits;
  if (digits.length === 12 && digits.startsWith('380')) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10, 12)}`;
  }
  return String(phone).startsWith('+') ? String(phone) : `+${digits || phone}`;
}

// Мініатюра товару — єдиний розмір усюди (Товари, Комплекти), 2026-09-05.
export function Thumb({ url }) {
  return url
    ? <img src={url} alt="" className="h-28 w-28 rounded-md object-cover" />
    : <div className="flex h-28 w-28 items-center justify-center rounded-md bg-slate-800 text-slate-600">—</div>;
}

export function money(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`;
}
