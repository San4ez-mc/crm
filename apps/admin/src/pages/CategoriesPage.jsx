// §9.4 Категорії — список + форма (drawer/модалка).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Button, IconButton, Field, Input, Textarea, Select, Card, EmptyState, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';
import SizeFitEditor, { fitChartToRows } from '../components/common/SizeFitEditor';
import { SingleFileDrop } from '../components/common/FileDropInput';

export default function CategoriesPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null=закрито, {}=нова, {...}=редагування

  async function load() {
    setError('');
    try { setItems((await api.listCategories()).data); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function handleSave(form) {
    try {
      if (form.id) await api.updateCategory(form.id, form);
      else await api.createCategory(form);
      setEditing(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function handleDelete(id) {
    if (!confirm('Видалити категорію?')) return;
    try { await api.deleteCategory(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <PageHeader title="Категорії" action={<Button onClick={() => setEditing({})}>+ Категорія</Button>} />
      <ErrorBanner message={error} />
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Категорій ще немає" action={<Button onClick={() => setEditing({})}>+ Категорія</Button>} />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Назва</th><th className="px-4 py-3">Товарів</th><th className="px-4 py-3">Розміри</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                  <td className="px-4 py-3">{c.name}</td>
                  <td className="px-4 py-3 text-slate-400">{c.productsCount}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{c.fitChart && Object.keys(c.fitChart).length ? 'своя сітка' : 'сітка магазину'}{Array.isArray(c.sizeRules) && c.sizeRules.length ? ', меж: ' + c.sizeRules.length : ''}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1.5">
                      <IconButton onClick={() => setEditing(c)}>✏️</IconButton>
                      <IconButton onClick={() => handleDelete(c.id)}>🗑️</IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal isOpen={!!editing} title={editing?.id ? 'Редагувати категорію' : 'Нова категорія'} onClose={() => setEditing(null)}>
        {editing && <CategoryForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function CategoryForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id, name: initial.name || '', description: initial.description || '', aiInstructions: initial.aiInstructions || '',
    requiredParams: initial.requiredParams || [], synonyms: initial.synonyms || [], questionFlow: initial.questionFlow || { questions: [] },
    // Розміри (2026-10-18) — для товарів категорії, у яких немає власних
    fitRows: fitChartToRows(initial.fitChart), sizeRules: Array.isArray(initial.sizeRules) ? initial.sizeRules : [], sizeChartImage: initial.sizeChartImage || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); const { fitRows, ...rest } = form; onSave({ ...rest, fitChart: fitRows.length ? fitRows : null, questionFlow: rest.questionFlow && rest.questionFlow.questions && rest.questionFlow.questions.length ? rest.questionFlow : null }); }}>
      <Field label="Назва"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Опис"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Синоніми (слова клієнта, за якими воронка розпізнає цю категорію в тексті)">
        <Input
          placeholder="напр. лофери, кросівки, туфлі, черевики, кеди"
          value={(form.synonyms || []).join(', ')}
          onChange={(e) => setForm({ ...form, synonyms: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
      <Field label="Параметри, які треба запитати перед оформленням">
        <RequiredParamsEditor value={form.requiredParams} onChange={(v) => setForm({ ...form, requiredParams: v })} />
      </Field>
      <Field label="Питання з умовами (необовʼязково): що питати по порядку і коли">
        <QuestionFlowEditor value={form.questionFlow} onChange={(v) => setForm({ ...form, questionFlow: v })} />
      </Field>
      <Field label="Інформація для ШІ (вільний текст, додатково до параметрів вище)">
        <Textarea rows={3} placeholder="Напр. нюанси розмірної сітки, застереження для бота" value={form.aiInstructions} onChange={(e) => setForm({ ...form, aiInstructions: e.target.value })} />
      </Field>
      <div className="mt-4 rounded-lg border border-slate-800 p-3">
        <div className="mb-2 text-sm font-semibold text-slate-200">Розміри для товарів цієї категорії</div>
        <div className="mb-3 text-xs text-slate-500">Діє для всіх товарів категорії, у яких немає власної сітки чи меж (у товарі можна задати свої).</div>
        <SizeFitEditor fitRows={form.fitRows} onFitRows={(v) => setForm({ ...form, fitRows: v })} rules={form.sizeRules} onRules={(v) => setForm({ ...form, sizeRules: v })} inheritNote="Порожньо — береться загальна сітка магазину (Налаштування → Загальні)." rulesInheritNote="Порожньо — беруться межі магазину (Налаштування → Загальні)." />
        <Field label="Картинка розмірної сітки (для товарів без своєї)">
          <SingleFileDrop value={form.sizeChartImage} onChange={(url) => setForm({ ...form, sizeChartImage: url })} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}


// Питання категорії з умовами (21.11, правка Олексія про унісекс): питання по порядку; у кожного — що спитати, допустимі відповіді і за якої умови воно задається
// («відповідь на попереднє питання дорівнює цьому або цьому значенню»). Розмірна таблиця за обмірами — окремим блоком (JSON).
function QuestionFlowEditor({ value, onChange }) {
  const flow = value && Array.isArray(value.questions) ? value : { questions: [] };
  const qs = flow.questions;
  const set = (questions) => onChange({ ...flow, questions });
  const upd = (i, patch) => set(qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  const csv = (arr) => (Array.isArray(arr) ? arr : []).join(', ');
  const fromCsv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const add = () => set([...qs, { id: 'q' + (qs.length + 1), kind: 'options', ask: '', options: [{ value: '', aliases: [] }, { value: '', aliases: [] }] }]);
  const [sizingText, setSizingText] = useState(flow.sizing ? JSON.stringify(flow.sizing, null, 2) : '');
  const [sizingErr, setSizingErr] = useState('');
  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">Порожньо — бот питає звичайні параметри категорії (вище). Тут можна задати послідовність із умовами: наприклад «Для кого костюм?» → якщо «чоловік» — зріст і вага, якщо «жінка» — чотири обміри.</div>
      {qs.map((q, i) => (
        <div key={i} className="rounded-lg border border-slate-800 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400"><span>Питання {i + 1} · код <b>{q.id}</b></span><IconButton onClick={() => set(qs.filter((_, idx) => idx !== i))}>🗑️</IconButton></div>
          <div className="grid gap-2 md:grid-cols-2">
            <Select value={q.kind || 'options'} onChange={(e) => upd(i, { kind: e.target.value })}>
              <option value="options">Вибір із варіантів</option>
              <option value="numbers">Кілька чисел (через пробіл)</option>
              <option value="legacy">Далі — звичайні параметри категорії</option>
            </Select>
            {i > 0 && (
              <Select value={(q.showIf && q.showIf.question) || ''} onChange={(e) => upd(i, { showIf: e.target.value ? { question: e.target.value, in: (q.showIf && q.showIf.in) || [] } : undefined })}>
                <option value="">Задавати завжди</option>
                {qs.slice(0, i).map((p) => <option key={p.id} value={p.id}>Задавати, якщо відповідь на «{p.id}» …</option>)}
              </Select>
            )}
          </div>
          {q.showIf && q.showIf.question && <Input className="mt-2" placeholder="… дорівнює (через кому): напр. жінка" value={csv(q.showIf.in)} onChange={(e) => upd(i, { showIf: { ...q.showIf, in: fromCsv(e.target.value) } })} />}
          {q.kind !== 'legacy' && <Textarea className="mt-2" rows={2} placeholder="Що спитати клієнта" value={q.ask || ''} onChange={(e) => upd(i, { ask: e.target.value })} />}
          {q.kind === 'options' && (
            <div className="mt-2 space-y-1">
              {(q.options || []).map((o, oi) => (
                <div key={oi} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                  <Input placeholder="варіант (напр. жінка)" value={o.value || ''} onChange={(e) => upd(i, { options: q.options.map((x, xi) => (xi === oi ? { ...x, value: e.target.value } : x)) })} />
                  <Input placeholder="як ще можуть написати (через кому): дівчина, дівчину, жінку" value={csv(o.aliases)} onChange={(e) => upd(i, { options: q.options.map((x, xi) => (xi === oi ? { ...x, aliases: fromCsv(e.target.value) } : x)) })} />
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={() => upd(i, { options: [...(q.options || []), { value: '', aliases: [] }] })}>+ Варіант</Button>
            </div>
          )}
          {q.kind === 'numbers' && <Input className="mt-2" placeholder="Які числа чекаємо, у цьому порядку (через кому): зріст, груди, талія, стегна" value={csv(q.fields)} onChange={(e) => upd(i, { fields: fromCsv(e.target.value) })} />}
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={add}>+ Питання</Button>
      <div className="rounded-lg border border-slate-800 p-3">
        <div className="mb-1 text-sm font-semibold text-slate-200">Розмір за обмірами (таблиця й правила, JSON)</div>
        <div className="mb-2 text-xs text-slate-500">Для відповіді з числами: яка таблиця діапазонів, коли розмір один, а коли радити окремо штани й кофту. Лишіть порожнім, якщо не потрібно.</div>
        <Textarea rows={8} value={sizingText} onChange={(e) => { setSizingText(e.target.value); try { const t = e.target.value.trim(); onChange({ ...flow, sizing: t ? JSON.parse(t) : undefined }); setSizingErr(''); } catch (er) { setSizingErr('JSON ще не коректний — не збережеться, поки не виправите'); } }} />
        {sizingErr && <div className="mt-1 text-xs text-amber-400">{sizingErr}</div>}
      </div>
    </div>
  );
}

function RequiredParamsEditor({ value = [], onChange }) {
  function update(i, field, v) {
    onChange(value.map((row, idx) => (idx === i ? { ...row, [field]: v } : row)));
  }
  function remove(i) { onChange(value.filter((_, idx) => idx !== i)); }
  function add() { onChange([...value, { name: '', unit: '', hint: '' }]); }
  return (
    <div className="space-y-2">
      {value.map((row, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,70px)_minmax(0,1fr)_auto] items-center gap-2">
          <Input placeholder="напр. зріст" value={row.name || ''} onChange={(e) => update(i, 'name', e.target.value)} />
          <Input placeholder="см" value={row.unit || ''} onChange={(e) => update(i, 'unit', e.target.value)} />
          <Input placeholder="підказка боту (необовʼязково)" value={row.hint || ''} onChange={(e) => update(i, 'hint', e.target.value)} />
          <IconButton onClick={() => remove(i)}>🗑️</IconButton>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={add}>+ Параметр</Button>
    </div>
  );
}
