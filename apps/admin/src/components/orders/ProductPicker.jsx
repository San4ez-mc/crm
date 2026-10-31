// Вибір товару з пошуком (Edits Олексія, 31.10: «тут якийсь пошук по товарам треба зробити, бо занадто багато товарів»).
// Замінює довгий випадаючий список у формах замовлення: клік → поле пошуку + відфільтрований список. Шукає за назвою, назвою для
// клієнта й артикулом, слова в будь-якому порядку («кофта A0187», «пуховик зима»). Той самий контракт, що в нативного <select>.
import { useEffect, useMemo, useRef, useState } from 'react';

export default function ProductPicker({ products, value, label, onChange, placeholder = '— оберіть товар —' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const current = products.find((p) => p.id === value);
  const text = current ? current.name : (value ? (label || '') : '');

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const list = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return products
      .filter((p) => { const hay = [p.name, p.customerName, p.sku].filter(Boolean).join(' ').toLowerCase(); return tokens.every((t) => hay.includes(t)); })
      .slice(0, 80);
  }, [products, q]);

  function pick(id) { onChange(id); setOpen(false); setQ(''); }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-left text-sm text-slate-100 focus:border-brand focus:outline-none"
      >
        <span className={`truncate ${text ? '' : 'text-slate-400'}`}>{text || placeholder}</span>
        <span className="text-xs text-slate-500">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[18rem] rounded-lg border border-slate-700 bg-slate-900 p-1.5 shadow-xl">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && list.length === 1) { e.preventDefault(); pick(list[0].id); } }}
            placeholder="Пошук: назва або артикул…"
            className="mb-1.5 w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none"
          />
          <ul className="max-h-64 overflow-auto">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => pick(p.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-slate-800 ${p.id === value ? 'bg-slate-800 text-brand-light' : 'text-slate-200'}`}
                >
                  <span className="truncate">{p.name}</span>
                  {p.sku && <span className="shrink-0 text-xs text-slate-500">{p.sku}</span>}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-2.5 py-2 text-xs text-slate-500">Нічого не знайдено</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
