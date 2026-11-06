// Підказки для нових користувачів (2026-11-06): короткий тур по меню — що де лежить. Показується один раз кожному, хто його ще не бачив
// (стан зберігається на сервері по id з SSO: таблиця UserTour), у демо-магазині і в нових компаніях після оплати теж. Знову запустити
// можна посиланням «Підказки» внизу меню. Кроки, чиїх пунктів меню користувач не бачить (обмежені права), пропускаємо.
import { useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';

export const TOUR_KEY = 'welcome-v1';

const STEPS = [
  { title: 'Вітаємо у Fineko CRM', text: 'За хвилину покажемо, де що лежить. Це можна пропустити, а потім відкрити знову через «Підказки» внизу меню.' },
  { target: '/orders', title: 'Замовлення', text: 'Усі замовлення на дошці: колонки це етапи від «написав» до «клієнт забрав». Картку можна відкрити, змінити, перетягнути на інший етап або видалити.' },
  { target: '/products', title: 'Товари', text: 'Каталог: кольори, розміри, ціни, комплекти. З цього рахується прибуток і працює AI-продавець.' },
  { target: '/suppliers', title: 'Постачальники', text: 'Для дропшипінгу: контакти постачальника, ключі та ціна, за якою ви його купуєте. Від ціни залежить ваш прибуток.' },
  { target: '/daily-analytics', title: 'Щоденна аналітика', text: 'Скільки ви заробили за день з урахуванням реклами, відмов і витрат. Курс і постійні витрати можна вписати в клітинках.' },
  { target: '/ad-spend', title: 'Реклама', text: 'Скільки витрачено на кожне оголошення і скільки замовлень воно принесло. Видно, що продає, а що ні.' },
  { target: '/settings/general', title: 'Налаштування', text: 'Ключ для підключення сайту, Нова пошта, передоплата та інші параметри магазину.' },
  { target: '/billing', title: 'Тариф', text: 'Який у вас тариф і до коли він оплачений. За 7 днів до кінця це місце підсвітиться, тут же й оплата.' },
];

export const useTourStore = create((set) => ({
  active: false,
  start: () => set({ active: true }),
  stop: () => set({ active: false }),
}));

const targetEl = (sel) => (sel ? document.querySelector(`[data-tour="${sel}"]`) : null);
// Пункт меню на екрані (на телефоні меню виїжджає зліва: поки закрите, воно за межами екрана — тоді підказка стає карткою по центру).
const isVisible = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
};

export function TourHost() {
  const { isAuthenticated } = useAuthStore();
  const { active, start, stop } = useTourStore();
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);

  // Автозапуск: користувач ще не бачив цей тур.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let dead = false;
    api.toursSeen().then((r) => { if (!dead && !(r.data.seen || []).includes(TOUR_KEY)) setTimeout(() => !dead && start(), 900); }).catch(() => {});
    return () => { dead = true; };
  }, [isAuthenticated]);

  // Лише ті кроки, чий пункт меню є в меню (нема прав на розділ → крок пропускаємо).
  const steps = active ? STEPS.filter((s) => !s.target || !!targetEl(s.target)) : [];
  const step = steps[idx];

  useLayoutEffect(() => {
    if (!active || !step) return undefined;
    const update = () => { const el = targetEl(step.target); setRect(isVisible(el) ? el.getBoundingClientRect() : null); };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [active, idx, step && step.target]);

  if (!active || !step) return null;

  const finish = () => { stop(); setIdx(0); api.tourMarkSeen(TOUR_KEY).catch(() => {}); };
  const last = idx >= steps.length - 1;
  const pad = 4;
  const box = rect
    ? { left: Math.min(rect.right + 14, window.innerWidth - 336), top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 220)) }
    : { left: Math.max(12, (window.innerWidth - 320) / 2), top: Math.max(12, window.innerHeight / 2 - 100) };

  return (
    <div className="fixed inset-0 z-[90]">
      {rect ? (
        <div className="pointer-events-none absolute rounded-lg ring-2 ring-brand" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgba(2,6,23,0.72)' }} />
      ) : <div className="absolute inset-0 bg-slate-950/70" />}
      <div className="absolute w-80 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl" style={box} role="dialog" aria-label={step.title}>
        <div className="text-xs text-slate-500">Крок {idx + 1} з {steps.length}</div>
        <div className="mt-1 text-base font-semibold text-slate-100">{step.title}</div>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{step.text}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={finish} className="text-xs text-slate-500 hover:text-slate-300">Пропустити</button>
          <div className="flex gap-2">
            {idx > 0 && <button type="button" onClick={() => setIdx(idx - 1)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">Назад</button>}
            <button type="button" onClick={() => (last ? finish() : setIdx(idx + 1))} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark">{last ? 'Готово' : 'Далі'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
