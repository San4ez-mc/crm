// Розміри як дані (2026-10-18): сітка підбору за зростом/вагою + межі від експерта. Один редактор для категорії й товару —
// виглядає однаково. Порожньо = успадковується (товар ← категорія ← загальна сітка воронки).
import { Input, Button, IconButton } from './Common';

const ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'XXXXL'];

/** {"S":{"height":[a,b],"weight":[c,d]}} → рядки таблиці */
export function fitChartToRows(chart) {
  if (!chart || typeof chart !== 'object') return [];
  return Object.entries(chart)
    .map(([size, r]) => ({ size, hMin: (r.height || [])[0] ?? '', hMax: (r.height || [])[1] ?? '', wMin: (r.weight || [])[0] ?? '', wMax: (r.weight || [])[1] ?? '' }))
    .sort((a, b) => ORDER.indexOf(a.size) - ORDER.indexOf(b.size));
}

function Num({ value, onChange, placeholder }) {
  return <Input type="number" inputMode="numeric" placeholder={placeholder} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
}

/**
 * fitRows — рядки сітки [{size,hMin,hMax,wMin,wMax}]; rules — [{size,wMin,wMax,hMin,hMax,note}].
 * inheritNote — підказка, звідки береться, коли порожньо.
 */
export default function SizeFitEditor({ fitRows = [], onFitRows, rules = [], onRules, inheritNote }) {
  const setFit = (i, k, v) => onFitRows(fitRows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const setRule = (i, k, v) => onRules(rules.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const head = 'text-xs uppercase text-slate-500';
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-sm font-medium text-slate-300">Сітка підбору розміру (зріст / вага)</div>
        <div className="mb-2 text-xs text-slate-500">За цією таблицею бот підбирає розмір клієнту. {fitRows.length ? '' : (inheritNote || 'Порожньо — береться загальна.')}</div>
        {fitRows.length > 0 && (
          <div className={'grid grid-cols-[70px_repeat(4,minmax(0,1fr))_auto] gap-2 ' + head}>
            <span>Розмір</span><span>Зріст від</span><span>Зріст до</span><span>Вага від</span><span>Вага до</span><span />
          </div>
        )}
        <div className="space-y-2">
          {fitRows.map((r, i) => (
            <div key={i} className="grid grid-cols-[70px_repeat(4,minmax(0,1fr))_auto] items-center gap-2">
              <Input placeholder="M" value={r.size || ''} onChange={(e) => setFit(i, 'size', e.target.value)} />
              <Num placeholder="см" value={r.hMin} onChange={(v) => setFit(i, 'hMin', v)} />
              <Num placeholder="см" value={r.hMax} onChange={(v) => setFit(i, 'hMax', v)} />
              <Num placeholder="кг" value={r.wMin} onChange={(v) => setFit(i, 'wMin', v)} />
              <Num placeholder="кг" value={r.wMax} onChange={(v) => setFit(i, 'wMax', v)} />
              <IconButton onClick={() => onFitRows(fitRows.filter((_, idx) => idx !== i))}>🗑️</IconButton>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" className="mt-2" onClick={() => onFitRows([...fitRows, { size: '', hMin: '', hMax: '', wMin: '', wMax: '' }])}>+ Розмір</Button>
      </div>

      <div>
        <div className="mb-1 text-sm font-medium text-slate-300">Межі розмірів (уточнення від експерта)</div>
        <div className="mb-2 text-xs text-slate-500">Перекривають сітку там, де вона помиляється. Перше правило, що підходить, виграє. Напр.: «S, вага 50–66, зріст до 178» — невисокому M висітиме. {rules.length ? '' : (inheritNote ? 'Порожньо — беруться межі категорії.' : '')}</div>
        {rules.length > 0 && (
          <div className={'grid grid-cols-[70px_repeat(4,minmax(0,1fr))_minmax(0,2fr)_auto] gap-2 ' + head}>
            <span>Розмір</span><span>Вага від</span><span>Вага до</span><span>Зріст від</span><span>Зріст до</span><span>Примітка</span><span />
          </div>
        )}
        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-[70px_repeat(4,minmax(0,1fr))_minmax(0,2fr)_auto] items-center gap-2">
              <Input placeholder="S" value={r.size || ''} onChange={(e) => setRule(i, 'size', e.target.value)} />
              <Num placeholder="кг" value={r.wMin} onChange={(v) => setRule(i, 'wMin', v)} />
              <Num placeholder="кг" value={r.wMax} onChange={(v) => setRule(i, 'wMax', v)} />
              <Num placeholder="см" value={r.hMin} onChange={(v) => setRule(i, 'hMin', v)} />
              <Num placeholder="см" value={r.hMax} onChange={(v) => setRule(i, 'hMax', v)} />
              <Input placeholder="чому (необовʼязково)" value={r.note || ''} onChange={(e) => setRule(i, 'note', e.target.value)} />
              <IconButton onClick={() => onRules(rules.filter((_, idx) => idx !== i))}>🗑️</IconButton>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" className="mt-2" onClick={() => onRules([...rules, { size: '', wMin: '', wMax: '', hMin: '', hMax: '', note: '' }])}>+ Межа</Button>
      </div>
    </div>
  );
}
