// «База знань» (ТЗ-база-знань-магазину.md, 2026-09-04) — FAQ/політики/заперечення/скрипти
// в одному місці замість funnelKey SHOP_FAQ (дублювався на кожен бот) і векторної бази без
// історії. 4 вкладки: Профіль (короткі факти завжди в промпті), Записи (керована таблиця),
// Без відповіді (чернетки з реальних діалогів — askManager), Імпорт (разовий перенос).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Input, Textarea, Select, Button, Field, Label, Badge, EmptyState, ErrorBanner } from '../components/common/Common';

const KIND_LABEL = { faq: 'FAQ', policy: 'Політика', objection: 'Заперечення', script: 'Скрипт' };
const KIND_COLOR = { faq: 'teal', policy: 'slate', objection: 'amber', script: 'green' };

export default function KnowledgeBasePage() {
  const [tab, setTab] = useState('profile');
  return (
    <div>
      <PageHeader
        title="База знань"
        action={
          <div className="flex gap-2">
            {[['profile', 'Профіль'], ['entries', 'Записи'], ['unanswered', 'Без відповіді'], ['import', 'Імпорт']].map(([v, label]) => (
              <button key={v} onClick={() => setTab(v)} className={`rounded-lg px-3 py-1.5 text-xs ${tab === v ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300'}`}>{label}</button>
            ))}
          </div>
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-slate-400">
        Тут менеджер веде знання магазину (FAQ, політики, заперечення, скрипти відповідей) в одному місці —
        замість того щоб дублювати їх у ключах кожної окремої воронки. Дані звідси автоматично підтягує бот
        у діалозі з клієнтом: короткий «Профіль» — завжди в промпті (виробник/доставка/примірка/оплата),
        а «Записи» — за потреби, коли питання клієнта схоже на щось із бази. Питання, на які бот не знайшов
        відповіді, самі зʼявляються у вкладці «Без відповіді» — досить один раз дописати відповідь.
      </p>
      {tab === 'profile' && <ProfileTab />}
      {tab === 'entries' && <EntriesTab />}
      {tab === 'unanswered' && <UnansweredTab />}
      {tab === 'import' && <ImportTab />}
    </div>
  );
}

// ── Профіль ──────────────────────────────────────────────────────────────
function ProfileTab() {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.getKnowledgeProfile().then((r) => setForm(r.data)).catch((e) => setError(e.message)); }, []);

  async function save() {
    setError(''); setSaved(false);
    try {
      await api.updateKnowledgeProfile({
        producerLine: form.producerLine, shippingLine: form.shippingLine,
        fittingLine: form.fittingLine, paymentLine: form.paymentLine, termsLine: form.termsLine,
      });
      setSaved(true);
    } catch (e) { setError(e.message); }
  }

  if (!form) return null;
  const fields = [
    ['producerLine', 'Виробник', 'Показується, коли клієнт питає «хто виробник / де шиють»'],
    ['shippingLine', 'Доставка', 'Показується на питання «коли відправка / як довго їде»'],
    ['fittingLine', 'Примірка', 'Показується на питання «чи можна приміряти / повернути якщо не підійде»'],
    ['paymentLine', 'Оплата', 'Показується на питання «як оплатити / які способи оплати»'],
    ['termsLine', 'Умови (загальні)', 'Загальні умови магазину — те, що раніше було в ORDER_TERMS_LINE'],
  ];
  return (
    <div>
      <ErrorBanner message={error} />
      <Card className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-2">
        {fields.map(([key, label, hint]) => (
          <Field key={key} label={label}>
            <Textarea rows={2} value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            <div className="mt-1 text-xs text-slate-500">{hint}</div>
          </Field>
        ))}
        <div className="flex items-center gap-3 lg:col-span-2">
          <Button onClick={save}>Зберегти</Button>
          {saved && <span className="text-xs text-emerald-400">Збережено ✓</span>}
        </div>
      </Card>
    </div>
  );
}

// ── Записи ───────────────────────────────────────────────────────────────
function EntriesTab() {
  const [items, setItems] = useState(null);
  const [kind, setKind] = useState('');
  const [scope, setScope] = useState('');
  const [active, setActive] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // entry object being created/edited, or null
  const [testQuestion, setTestQuestion] = useState('');
  const [testResult, setTestResult] = useState(null);

  async function load() {
    setError('');
    try {
      const params = {};
      if (kind) params.kind = kind;
      if (scope) params.scope = scope;
      if (active) params.active = active;
      if (q) params.q = q;
      setItems((await api.listKnowledge(params)).data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [kind, scope, active, q]);

  async function saveEntry(entry) {
    try {
      if (entry.id) await api.updateKnowledge(entry.id, entry);
      else await api.createKnowledge(entry);
      setEditing(null);
      load();
    } catch (e) { alert(e.message); }
  }
  async function toggleActive(entry) {
    try { await api.updateKnowledge(entry.id, { isActive: !entry.isActive }); load(); } catch (e) { alert(e.message); }
  }
  async function remove(entry) {
    if (!confirm('Видалити запис?')) return;
    try { await api.deleteKnowledge(entry.id); load(); } catch (e) { alert(e.message); }
  }
  async function runTest() {
    setTestResult(null);
    if (!testQuestion.trim()) return;
    try { setTestResult((await api.searchKnowledge({ q: testQuestion, scope: 'shop' })).data); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <ErrorBanner message={error} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Пошук у питаннях/відповідях…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-[160px]" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Усі типи</option>
          {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select className="max-w-[160px]" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="">Усі рівні</option>
          <option value="shop">Весь магазин</option>
          <option value="category">Категорія</option>
          <option value="product">Товар</option>
        </Select>
        <Select className="max-w-[160px]" value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">Активні й ні</option>
          <option value="true">Тільки активні</option>
          <option value="false">Тільки вимкнені</option>
        </Select>
        <Button onClick={() => setEditing({ kind: 'faq', scope: 'shop', tags: [], priority: 0, isActive: true })}>+ Новий запис</Button>
      </div>

      <Card className="mb-4 p-4">
        <Label>Перевірити, як відповість бот</Label>
        <div className="flex gap-2">
          <Input placeholder="Введіть питання клієнта…" value={testQuestion} onChange={(e) => setTestQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runTest()} />
          <Button variant="secondary" onClick={runTest}>Перевірити</Button>
        </div>
        {testResult && (
          <div className="mt-3 space-y-2">
            {testResult.length === 0 ? <div className="text-xs text-slate-500">Нічого не знайдено — бот попросить покликати менеджера.</div> : testResult.map((r) => (
              <div key={r.id} className="rounded-lg bg-slate-800/50 px-3 py-2 text-xs">
                <div className="text-slate-400">{r.question}</div>
                <div className="mt-0.5">{r.answer}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Записів ще немає" hint="Додайте перший вручну або перенесіть через вкладку «Імпорт»." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Тип</th><th className="px-4 py-3">Питання</th><th className="px-4 py-3">Відповідь</th><th className="px-4 py-3">Теги</th><th className="px-4 py-3">Рівень</th><th className="px-4 py-3">Активний</th><th className="px-4 py-3"></th></tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-slate-800/60 last:border-0">
                  <td className="px-4 py-3"><Badge color={KIND_COLOR[e.kind]}>{KIND_LABEL[e.kind]}</Badge></td>
                  <td className="px-4 py-3 max-w-xs truncate" title={e.question}>{e.question || '—'}</td>
                  <td className="px-4 py-3 max-w-sm truncate text-slate-400" title={e.answer}>{e.answer}</td>
                  <td className="px-4 py-3 text-slate-400">{e.tags?.join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{e.scope === 'shop' ? 'Магазин' : e.scope === 'category' ? (e.category?.name || 'Категорія') : (e.product?.name || 'Товар')}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleActive(e)}><Badge color={e.isActive ? 'green' : 'slate'}>{e.isActive ? 'Так' : 'Ні'}</Badge></button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(e)} className="mr-2 text-xs text-brand-light hover:underline">Редагувати</button>
                    <button onClick={() => remove(e)} className="text-xs text-slate-500 hover:text-red-400">Видалити</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing && <EntryFormModal entry={editing} onCancel={() => setEditing(null)} onSave={saveEntry} />}
    </div>
  );
}

function EntryFormModal({ entry, onCancel, onSave }) {
  const [form, setForm] = useState({ ...entry, tagsText: (entry.tags || []).join(', ') });
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-sm font-semibold">{entry.id ? 'Редагувати запис' : 'Новий запис'}</h3>
        <div className="space-y-3">
          <Field label="Тип">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Питання клієнта (варіанти через |)"><Input value={form.question || ''} onChange={(e) => setForm({ ...form, question: e.target.value })} /></Field>
          <Field label="Відповідь бота *"><Textarea rows={3} value={form.answer || ''} onChange={(e) => setForm({ ...form, answer: e.target.value })} /></Field>
          <Field label="Теги (через кому)"><Input value={form.tagsText} onChange={(e) => setForm({ ...form, tagsText: e.target.value })} /></Field>
          <Field label="Рівень">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
              <option value="shop">Весь магазин</option>
              <option value="category">Категорія</option>
              <option value="product">Товар</option>
            </Select>
          </Field>
          <Field label="Пріоритет (вище = раніше в промпті)"><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Скасувати</Button>
          <Button onClick={() => onSave({ ...form, tags: form.tagsText.split(',').map((t) => t.trim()).filter(Boolean) })} disabled={!form.answer?.trim()}>Зберегти</Button>
        </div>
      </div>
    </div>
  );
}

// ── Без відповіді ────────────────────────────────────────────────────────
function UnansweredTab() {
  const [items, setItems] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try { setItems((await api.listKnowledge({ active: 'false' })).data.filter((e) => e.source === 'from_dialog')); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function answer(entry) {
    const answer = drafts[entry.id];
    if (!answer?.trim()) return;
    try { await api.updateKnowledge(entry.id, { answer, isActive: true }); load(); } catch (e) { alert(e.message); }
  }
  async function skip(entry) {
    if (!confirm('Прибрати це питання зі списку («не потрібно»)?')) return;
    try { await api.deleteKnowledge(entry.id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <ErrorBanner message={error} />
      <p className="mb-4 text-xs text-slate-500">Питання клієнтів, на які бот не знав відповіді — впишіть відповідь і увімкніть, наступного разу бот відповість сам.</p>
      {items === null ? null : items.length === 0 ? (
        <EmptyState title="Немає питань без відповіді" hint="Зʼявляться тут автоматично, коли бот не знайде відповіді в базі." />
      ) : (
        <div className="space-y-3">
          {items.map((e) => (
            <Card key={e.id} className="p-4">
              <div className="mb-2 text-sm font-medium">{e.question}</div>
              {e.sessionId && <div className="mb-2 text-xs text-slate-500">Сесія: {e.sessionId}</div>}
              <Textarea rows={2} placeholder="Впишіть відповідь…" value={drafts[e.id] ?? ''} onChange={(ev) => setDrafts({ ...drafts, [e.id]: ev.target.value })} />
              <div className="mt-2 flex gap-2">
                <Button onClick={() => answer(e)} disabled={!drafts[e.id]?.trim()}>Відповісти й увімкнути</Button>
                <Button variant="secondary" onClick={() => skip(e)}>Не потрібно</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Імпорт ───────────────────────────────────────────────────────────────
function ImportTab() {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  async function doPreview() {
    setError(''); setDone(null);
    try { setPreview((await api.importKnowledge({ text, preview: true })).data); } catch (e) { setError(e.message); }
  }
  async function confirmImport() {
    setError('');
    try { setDone((await api.importKnowledge({ text })).data); setPreview(null); setText(''); } catch (e) { setError(e.message); }
  }

  return (
    <div className="max-w-4xl">
      <ErrorBanner message={error} />
      <p className="mb-3 text-xs text-slate-500">Разовий перенос старої бази (Google-документ / векторна колекція). Один рядок — один запис: <code>питання;відповідь;тег1,тег2</code></p>
      <Textarea rows={10} placeholder={'Хто виробник?;Ми шиємо самі в Україні;виробник\nЧи можна приміряти?;Так, при отриманні на Новій Пошті;примірка,повернення'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={doPreview} disabled={!text.trim()}>Переглянути</Button>
        {preview && <Button onClick={confirmImport}>Імпортувати {preview.count} записів</Button>}
      </div>
      {done && <div className="mt-3 text-sm text-emerald-400">Імпортовано: {done.imported}</div>}
      {preview && (
        <Card className="mt-4 p-4">
          <div className="mb-2 text-xs text-slate-500">Превʼю ({preview.count}):</div>
          <div className="space-y-1 text-xs">
            {preview.rows.slice(0, 20).map((r, i) => (
              <div key={i} className="border-b border-slate-800/60 py-1">
                <span className="text-slate-400">{r.question || '(без питання)'}</span> → {r.answer} {r.tags.length > 0 && <span className="text-slate-600">[{r.tags.join(', ')}]</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
