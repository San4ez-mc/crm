// Сповіщення справа знизу (2026-11-06, Олексій: «коли вносяться зміни в CRM, що працюють через JS, нехай справа знизу спливає сповіщення»).
// Єдине місце: api/client.js сам показує «Збережено / Створено / Видалено» після кожної успішної зміни (POST/PATCH/PUT/DELETE) і червоне
// повідомлення про помилку, тож окремо в кожній сторінці нічого викликати не треба. Свій текст — toast.success('…').
import { create } from 'zustand';

let nextId = 1;
export const useToastStore = create((set, get) => ({
  items: [],
  push(type, text, ms) {
    const id = nextId++;
    const last = get().items[get().items.length - 1];
    if (last && last.text === text && last.type === type) return last.id; // однакове підряд не дублюємо
    set((s) => ({ items: [...s.items.slice(-3), { id, type, text }] }));
    setTimeout(() => get().dismiss(id), ms || (type === 'error' ? 7000 : 3200));
    return id;
  },
  dismiss(id) { set((s) => ({ items: s.items.filter((t) => t.id !== id) })); },
}));

export const toast = {
  success: (text, ms) => useToastStore.getState().push('success', text, ms),
  error: (text, ms) => useToastStore.getState().push('error', text, ms),
  info: (text, ms) => useToastStore.getState().push('info', text, ms),
};

const STYLE = {
  success: { bar: 'border-emerald-700 bg-emerald-950/90 text-emerald-100', icon: '✓' },
  error: { bar: 'border-red-700 bg-red-950/90 text-red-100', icon: '!' },
  info: { bar: 'border-slate-600 bg-slate-900/95 text-slate-100', icon: 'i' },
};

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${STYLE[t.type].bar}`}>
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">{STYLE[t.type].icon}</span>
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          <button type="button" onClick={() => dismiss(t.id)} className="shrink-0 text-xs opacity-60 hover:opacity-100" aria-label="Закрити">✕</button>
        </div>
      ))}
    </div>
  );
}
