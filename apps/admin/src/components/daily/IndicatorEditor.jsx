// Редактор власних показників «Щоденної аналітики» (Edits bb8fe39f / 26d9b146, 10.11): вікно «Додати показник» і права панель «Редагування показника»
// — за скріншотами Олексія. Логіка формул — lib/dailyIndicators.js, збереження — DailyAnalyticsPage.
import { useState } from 'react';
import { Input, Select, Button } from '../common/Common';
import { FORMATS, DECIMALS, OPS, formatValue } from '../../lib/dailyIndicators';

export const TYPE_CARDS = [
  { id: 'formula', icon: '𝑓𝑥', title: 'Формула', hint: 'Розрахунок на основі інших показників' },
  { id: 'manual', icon: '⌨', title: 'Ручне введення', hint: 'Вводите значення вручну' },
  { id: 'auto', icon: '🗄', title: 'З CRM / інтеграції', hint: 'Автоматичні дані із систем' },
];
const KINDS = [
  { id: 'percent', title: 'Відсоток від іншого показника' },
  { id: 'chain', title: 'Множення/ділення', example: 'Наприклад: {Показник A} × 0,1' },
  { id: 'diff', title: 'Різниця', example: 'Наприклад: {A} − {B}' },
  { id: 'expr', title: 'Власна формула', example: 'Наприклад: ({A} − {B}) × 0,1' },
];

export function emptyDraft() {
  return { label: '', type: 'formula', format: 'uah', decimals: 2, kind: 'chain', terms: [{ ref: '', num: '' }, { op: '×', ref: '', num: '' }], pct: '10', pctRef: '', a: '', b: '', text: '', autoRef: '' };
}

/** Чернетка з існуючого власного показника (для редагування й дублювання). */
export function draftFromRow(row) {
  const d = emptyDraft();
  const c = row.custom || {};
  d.label = row.label || ''; d.type = c.type || 'formula'; d.format = c.format || 'num'; d.decimals = c.decimals ?? 2;
  if (c.type === 'auto' && c.auto) d.autoRef = c.auto.ref;
  const f = c.formula;
  if (f) {
    d.kind = f.kind;
    if (f.kind === 'chain') d.terms = f.terms.map((t) => ({ ...(t.op ? { op: t.op } : {}), ref: t.ref || '', num: t.num != null ? String(t.num).replace('.', ',') : '' }));
    if (f.kind === 'percent') { d.pct = String(f.pct).replace('.', ','); d.pctRef = f.ref; }
    if (f.kind === 'diff') { d.a = f.a; d.b = f.b; }
    if (f.kind === 'expr') d.text = f.text;
  }
  return d;
}

/** Чернетка → { custom } для збереження; або { error } з поясненням. */
export function customFromDraft(d) {
  if (!d.label.trim()) return { error: 'Вкажіть назву показника' };
  const base = { type: d.type, format: d.format, decimals: Number(d.decimals) };
  if (d.type === 'manual') return { custom: base };
  if (d.type === 'auto') return d.autoRef ? { custom: { ...base, auto: { ref: d.autoRef } } } : { error: 'Оберіть, який показник брати з CRM' };
  if (d.kind === 'percent') {
    if (!d.pctRef) return { error: 'Оберіть показник, від якого рахувати відсоток' };
    if (d.pct === '' || Number.isNaN(Number(String(d.pct).replace(',', '.')))) return { error: 'Вкажіть відсоток числом' };
    return { custom: { ...base, formula: { kind: 'percent', ref: d.pctRef, pct: Number(String(d.pct).replace(',', '.')) } } };
  }
  if (d.kind === 'diff') return d.a && d.b ? { custom: { ...base, formula: { kind: 'diff', a: d.a, b: d.b } } } : { error: 'Оберіть обидва показники для різниці' };
  if (d.kind === 'expr') return d.text.trim() ? { custom: { ...base, formula: { kind: 'expr', text: d.text.trim() } } } : { error: 'Впишіть формулу' };
  const terms = [];
  for (const [i, t] of d.terms.entries()) {
    if (!t.ref && (t.num === '' || t.num == null || Number.isNaN(Number(String(t.num).replace(',', '.'))))) return { error: i === 0 ? 'Оберіть показник або впишіть число' : 'Заповніть усі частини формули' };
    terms.push({ ...(i > 0 ? { op: t.op || '×' } : {}), ...(t.ref ? { ref: t.ref } : { num: Number(String(t.num).replace(',', '.')) }) });
  }
  return { custom: { ...base, formula: { kind: 'chain', terms } } };
}

function Operand({ term, onChange, options, first }) {
  return (
    <>
      <Select className="!w-auto min-w-[8rem] flex-1" value={term.ref} onChange={(e) => onChange({ ...term, ref: e.target.value })}>
        <option value="">{first ? '— показник або число —' : '— число —'}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </Select>
      {!term.ref && <Input className="!w-24" placeholder="0,1" value={term.num} onChange={(e) => onChange({ ...term, num: e.target.value })} />}
    </>
  );
}

function ChainBuilder({ draft, set, options }) {
  const setTerm = (i, t) => set({ ...draft, terms: draft.terms.map((x, j) => (j === i ? t : x)) });
  return (
    <div className="space-y-2">
      {draft.terms.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          {i > 0 && (
            <Select className="!w-16 text-center" value={t.op || '×'} onChange={(e) => setTerm(i, { ...t, op: e.target.value })}>
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          )}
          <Operand term={t} first={i === 0} options={options} onChange={(nt) => setTerm(i, nt)} />
          {i > 0 && <button type="button" className="text-slate-500 hover:text-red-400" title="Прибрати" onClick={() => set({ ...draft, terms: draft.terms.filter((_, j) => j !== i) })}>✕</button>}
        </div>
      ))}
      {draft.terms.length < 8 && <Button type="button" variant="secondary" className="!py-1 text-xs" onClick={() => set({ ...draft, terms: [...draft.terms, { op: '×', ref: '', num: '' }] })}>+ Додати</Button>}
      <p className="text-[11px] text-slate-500">Рахується зліва направо: спочатку перші два, потім результат із наступним.</p>
    </div>
  );
}

function FormulaFields({ draft, set, options, variant }) {
  return (
    <div>
      {variant === 'panel' ? (
        <div className="mb-3 space-y-2">
          {KINDS.map((k) => (
            <label key={k.id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-200">
              <input type="radio" className="mt-1" checked={draft.kind === k.id} onChange={() => set({ ...draft, kind: k.id })} />
              <span>{k.title}{k.example && draft.kind !== k.id && <span className="block text-[11px] text-slate-500">{k.example}</span>}</span>
            </label>
          ))}
        </div>
      ) : (
        <Select className="mb-3" value={draft.kind} onChange={(e) => set({ ...draft, kind: e.target.value })}>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.title}</option>)}
        </Select>
      )}
      {draft.kind === 'percent' && (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="!w-20" value={draft.pct} onChange={(e) => set({ ...draft, pct: e.target.value })} /> <span className="text-sm text-slate-400">% від</span>
          <Select className="!w-auto min-w-[10rem] flex-1" value={draft.pctRef} onChange={(e) => set({ ...draft, pctRef: e.target.value })}>
            <option value="">— показник —</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </div>
      )}
      {draft.kind === 'chain' && <ChainBuilder draft={draft} set={set} options={options} />}
      {draft.kind === 'diff' && (
        <div className="flex flex-wrap items-center gap-2">
          <Select className="!w-auto min-w-[8rem] flex-1" value={draft.a} onChange={(e) => set({ ...draft, a: e.target.value })}><option value="">— A —</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          <span className="text-slate-400">−</span>
          <Select className="!w-auto min-w-[8rem] flex-1" value={draft.b} onChange={(e) => set({ ...draft, b: e.target.value })}><option value="">— B —</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
        </div>
      )}
      {draft.kind === 'expr' && (
        <div>
          <Input placeholder="({Назва A} − {Назва B}) × 0,1" value={draft.text} onChange={(e) => set({ ...draft, text: e.target.value })} />
          <Select className="mt-2 text-xs" value="" onChange={(e) => { if (e.target.value) set({ ...draft, text: (draft.text + ' {' + e.target.value + '}').trim() }); }}>
            <option value="">+ вставити назву показника…</option>{options.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
          </Select>
          <p className="mt-1 text-[11px] text-slate-500">Назви показників — у фігурних дужках. Дії: + − × ÷ і дужки.</p>
        </div>
      )}
    </div>
  );
}

/** Поля форми. variant: 'modal' (картки типу зліва, як у «Додати показник») або 'panel' (випадаючий тип + радіо, як у «Редагування показника»). */
export function IndicatorForm({ draft, set, options, variant, preview }) {
  const autoOptions = options.filter((o) => !o.custom);
  const previewBox = draft.type === 'formula' && preview && (
    <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-slate-300">
      Приклад ({preview.dayLabel}): <span className="font-semibold text-emerald-300">{preview.text}</span>
    </div>
  );
  const typeBody = (
    <>
      {draft.type === 'formula' && (<><div className="mb-1 text-xs font-medium text-slate-400">Формула{variant === 'panel' ? ' розрахунку' : ''}</div><FormulaFields draft={draft} set={set} options={options} variant={variant} />{previewBox}</>)}
      {draft.type === 'manual' && <p className="rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-400">Значення ви впишете самі в клітинках по днях. Введене діє й на наступні дні, поки не впишете нове.</p>}
      {draft.type === 'auto' && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">Який показник із CRM показувати</div>
          <Select value={draft.autoRef} onChange={(e) => set({ ...draft, autoRef: e.target.value })}><option value="">— обрати —</option>{autoOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
        </div>
      )}
    </>
  );
  const formatRow = (
    <div className="mt-3 grid grid-cols-2 gap-3">
      <div><div className="mb-1 text-xs font-medium text-slate-400">Формат</div>
        <Select value={draft.format} onChange={(e) => set({ ...draft, format: e.target.value })}>{FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></div>
      <div><div className="mb-1 text-xs font-medium text-slate-400">Округлення</div>
        <Select value={draft.decimals} onChange={(e) => set({ ...draft, decimals: Number(e.target.value) })}>{DECIMALS.map((n) => <option key={n} value={n}>{n === 0 ? 'Без знаків' : n === 1 ? 'До 1 знака' : 'До 2 знаків'}</option>)}</Select></div>
    </div>
  );
  const name = (
    <div className="mb-3">
      <div className="mb-1 text-xs font-medium text-slate-400">Назва показника{variant === 'modal' && <span className="text-red-400"> *</span>}</div>
      <Input value={draft.label} placeholder="Витрати на оплату праці, грн" onChange={(e) => set({ ...draft, label: e.target.value })} />
    </div>
  );
  if (variant === 'panel') {
    return (
      <div>
        {name}
        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-slate-400">Тип значення</div>
          <Select value={draft.type} onChange={(e) => set({ ...draft, type: e.target.value })}>
            <option value="formula">ƒx Формула (розрахункове)</option><option value="manual">Ручне введення</option><option value="auto">З CRM (автоматичний)</option>
          </Select>
        </div>
        {typeBody}{formatRow}
      </div>
    );
  }
  return (
    <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-200">Тип показника</div>
        <div className="space-y-2">
          {TYPE_CARDS.map((c) => (
            <button type="button" key={c.id} onClick={() => set({ ...draft, type: c.id })} className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left ${draft.type === c.id ? 'border-brand bg-brand/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'}`}>
              <span className="mt-0.5 text-lg text-slate-300">{c.icon}</span>
              <span className="flex-1"><span className="block text-sm font-semibold text-slate-100">{c.title}</span><span className="block text-[11px] text-slate-400">{c.hint}</span></span>
              <span className={`mt-1 h-3.5 w-3.5 rounded-full border ${draft.type === c.id ? 'border-brand bg-brand' : 'border-slate-600'}`} />
            </button>
          ))}
        </div>
      </div>
      <div>{name}{typeBody}{formatRow}</div>
    </div>
  );
}

/** Вікно «Додати показник». */
export function AddIndicatorModal({ onClose, onAdd, options, previewFor, afterOptions }) {
  const [draft, setDraft] = useState(emptyDraft());
  const [after, setAfter] = useState('');
  const [err, setErr] = useState('');
  const built = customFromDraft(draft);
  const pv = previewFor(draft);
  function submit() { if (built.error) { setErr(built.error); return; } onAdd({ label: draft.label.trim(), custom: built.custom }, after); }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-12">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-100">Додати показник</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200">✕</button>
        </div>
        <div className="p-6">
          <IndicatorForm draft={draft} set={(d) => { setDraft(d); setErr(''); }} options={options} variant="modal" preview={pv} />
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-slate-400">Розташування: після якого показника додати рядок</div>
            <Select value={after} onChange={(e) => setAfter(e.target.value)}><option value="">В кінець таблиці</option>{afterOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
          </div>
          {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-800 px-6 py-4">
          <Button variant="secondary" onClick={onClose}>Скасувати</Button>
          <Button onClick={submit}>Додати показник</Button>
        </div>
      </div>
    </div>
  );
}

/** Права панель «Редагування показника». Для вбудованого рядка — лише назва, переміщення, сховати. */
export function EditIndicatorPanel({ row, options, previewFor, onSave, onClose, onDuplicate, onMove, onDelete, canUp, canDown }) {
  const isCustom = !!row.custom;
  const [draft, setDraft] = useState(isCustom ? draftFromRow(row) : { ...emptyDraft(), label: row.label });
  const [err, setErr] = useState('');
  function save() {
    if (!isCustom) { if (!draft.label.trim()) { setErr('Вкажіть назву показника'); return; } onSave({ label: draft.label.trim() }); return; }
    const built = customFromDraft(draft); if (built.error) { setErr(built.error); return; }
    onSave({ label: draft.label.trim(), custom: built.custom });
  }
  return (
    <aside className="fixed right-4 top-20 z-40 max-h-[calc(100vh-6rem)] w-80 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-100">Редагування показника</h3><button onClick={onClose} className="text-slate-500 hover:text-slate-200">✕</button></div>
      {isCustom ? (
        <IndicatorForm draft={draft} set={(d) => { setDraft(d); setErr(''); }} options={options} variant="panel" preview={previewFor(draft)} />
      ) : (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-400">Назва показника</div>
          <Input value={draft.label} onChange={(e) => { setDraft({ ...draft, label: e.target.value }); setErr(''); }} />
          <p className="mt-3 rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-400">Це вбудований показник: його можна перейменувати, перемістити або сховати. Його значення система рахує сама. Потрібен інший розрахунок — додайте власний показник із формулою.</p>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      <Button className="mt-4 w-full" onClick={save}>Зберегти зміни</Button>
      <div className="mt-5 border-t border-slate-800 pt-4">
        <div className="mb-2 text-sm font-semibold text-slate-200">Швидкі дії з показником</div>
        <div className="space-y-1 text-sm">
          <button className="block w-full rounded-lg px-2 py-1.5 text-left text-slate-300 hover:bg-slate-800" onClick={onDuplicate}>⧉ Дублювати показник</button>
          <button disabled={!canUp} className="block w-full rounded-lg px-2 py-1.5 text-left text-slate-300 hover:bg-slate-800 disabled:opacity-30" onClick={() => onMove(-1)}>↑ Перемістити вище</button>
          <button disabled={!canDown} className="block w-full rounded-lg px-2 py-1.5 text-left text-slate-300 hover:bg-slate-800 disabled:opacity-30" onClick={() => onMove(1)}>↓ Перемістити нижче</button>
          <button className="block w-full rounded-lg px-2 py-1.5 text-left text-red-400 hover:bg-red-900/20" onClick={onDelete}>🗑 {isCustom ? 'Видалити показник' : 'Сховати показник'}</button>
        </div>
      </div>
    </aside>
  );
}

export { formatValue };
