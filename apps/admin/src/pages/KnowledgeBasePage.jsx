// «База знань» (ТЗ-база-знань-магазину.md, 2026-09-04; переоформлено 2026-09-08, 2026-09-17) —
// FAQ/політики/заперечення/скрипти в одному місці замість дублювання в ключах кожної воронки.
// 3 робочі вкладки за рівнем відповіді (shop / category+supplier / product) + Імпорт.
// «Записи» + «Без відповіді» з попередньої версії тепер живуть РАЗОМ у кожній вкладці
// (позначка «Потребують відповіді»). EntriesSection також переюзана в картці товару
// (ProductFormModal → ProductAnswersSection) — та сама сутність "Відповідь".
// 2026-09-17 (власник): картка «Профіль» (5 коротких фактів — виробник/доставка/примірка/
// оплата/умови, завжди в промпті бота) прибрана — той самий зміст дублювався окремими
// записами питання-відповідь нижче (і саме тому в KnowledgeProfile могла триматись ЗАСТАРІЛА
// версія факту, який деінде вже виправили: живий кейс fittingLine — старий текст казав
// "примірка неможлива", хоча за накладеним платежем клієнт МОЖЕ оглянути товар на пошті).
// Увесь зміст перенесено в звичайні KnowledgeEntry (shop-scope), KnowledgeProfile очищено —
// одне джерело істини замість двох. Модель/API KnowledgeProfile не видалені (безпечніше, ніж
// ламати n_shop_profile-code.js без потреби) — просто більше нема чого туди писати.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Input, Textarea, Select, Button, IconButton, Field, Label, Badge, EmptyState, ErrorBanner, Thumb } from '../components/common/Common';

const KIND_LABEL = { faq: 'FAQ', policy: 'Політика', objection: 'Заперечення', script: 'Скрипт' };
const KIND_COLOR = { faq: 'teal', policy: 'slate', objection: 'amber', script: 'green' };
const SCOPE_LABEL = { shop: 'Весь магазин', category: 'Категорія', supplier: 'Постачальник', product: 'Товар' };

export default function KnowledgeBasePage() {
  const [tab, setTab] = useState('shop');
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);

  useEffect(() => {
    api.listCategories().then((r) => setCategories(r.data)).catch(() => {});
    api.listSuppliers().then((r) => setSuppliers(r.data)).catch(() => {});
    api.listProducts({ take: '500' }).then((r) => setProducts(r.data)).catch(() => {});
  }, []);

  const ctx = { categories, suppliers, products };

  return (
    <div>
      <PageHeader
        title="База знань"
        action={
          <div className="flex gap-2">
            {[['shop', 'Загальні питання'], ['category', 'Категорії й постачальники'], ['product', 'Товари'], ['import', 'Імпорт']].map(([v, label]) => (
              <button key={v} onClick={() => setTab(v)} className={`rounded-lg px-3 py-1.5 text-xs ${tab === v ? 'bg-brand text-white' : 'bg-slate-800 text-slate-300'}`}>{label}</button>
            ))}
          </div>
        }
      />
      <p className="mb-4 max-w-3xl text-sm text-slate-400">
        Тут менеджер веде знання магазину в одному місці — замість того щоб дублювати їх у ключах
        кожної окремої воронки. «Загальні питання» — правила всього магазину; «Категорії й
        постачальники» — те, що стосується групи товарів або конкретного постачальника; «Товари» —
        відповіді по одному артикулу (ті самі відповіді видно і прямо в картці товару, у розділі
        «Відповіді»). Питання клієнтів, на які бот не знайшов відповіді, зʼявляються тут же під
        позначкою «Потребують відповіді» — досить один раз дописати відповідь.
      </p>
      {tab === 'shop' && (
        <>
          <TestBotCard />
          <EntriesSection scopes={['shop']} {...ctx} />
        </>
      )}
      {tab === 'category' && <EntriesSection scopes={['category', 'supplier']} {...ctx} />}
      {tab === 'product' && <EntriesSection scopes={['product']} {...ctx} />}
      {tab === 'import' && <ImportTab />}
    </div>
  );
}

// ── Перевірка, як відповість бот (шукає по scope=shop, як робить бот) ─────
function TestBotCard() {
  const [testQuestion, setTestQuestion] = useState('');
  const [testResult, setTestResult] = useState(null);

  async function runTest() {
    setTestResult(null);
    if (!testQuestion.trim()) return;
    try { setTestResult((await api.searchKnowledge({ q: testQuestion, scope: 'shop' })).data); } catch (e) { alert(e.message); }
  }

  return (
    <Card className="mb-6 p-4">
      <Label>Перевірити, як відповість бот</Label>
      <div className="flex gap-2">
        <Input placeholder="Введіть питання клієнта…" value={testQuestion} onChange={(e) => setTestQuestion(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runTest()} />
        <Button type="button" variant="secondary" onClick={runTest}>Перевірити</Button>
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
  );
}

// ── Відповіді: список + «потребують відповіді», для набору дозволених рівнів ─
export function EntriesSection({ scopes, categories = [], suppliers = [], products = [], lockProductId = null }) {
  const [items, setItems] = useState(null);
  const [kind, setKind] = useState('');
  const [scopeFilter, setScopeFilter] = useState(scopes.length === 1 ? scopes[0] : '');
  const [targetFilter, setTargetFilter] = useState('');
  const [active, setActive] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState(null);
  const [drafts, setDrafts] = useState({});

  const effectiveScopes = scopeFilter ? [scopeFilter] : scopes;

  async function load() {
    setError('');
    try {
      const params = { scope: effectiveScopes.join(',') };
      if (kind) params.kind = kind;
      if (q) params.q = q;
      if (lockProductId) params.productId = lockProductId;
      else if (targetFilter && effectiveScopes.length === 1) {
        if (effectiveScopes[0] === 'category') params.categoryId = targetFilter;
        else if (effectiveScopes[0] === 'supplier') params.supplierId = targetFilter;
        else if (effectiveScopes[0] === 'product') params.productId = targetFilter;
      }
      setItems((await api.listKnowledge(params)).data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, [kind, scopeFilter, targetFilter, q, lockProductId]);

  if (items === null) return <ErrorBanner message={error} />;

  const visible = active === '' ? items : items.filter((e) => String(e.isActive) === active);
  const unanswered = visible.filter((e) => e.source === 'from_dialog' && !e.isActive);
  const normal = visible.filter((e) => !(e.source === 'from_dialog' && !e.isActive));

  async function saveEntry(entry) {
    if (entry.id) await api.updateKnowledge(entry.id, entry);
    else await api.createKnowledge(entry);
    setCreating(false); load();
  }
  async function toggleActive(entry) { try { await api.updateKnowledge(entry.id, { isActive: !entry.isActive }); load(); } catch (e) { alert(e.message); } }
  async function remove(entry) { if (!confirm('Видалити запис?')) return; try { await api.deleteKnowledge(entry.id); load(); } catch (e) { alert(e.message); } }
  async function promote(entry) {
    const label = entry.scope === 'product' ? 'на категорію' : 'на весь магазин';
    if (!confirm(`Підняти цю відповідь ${label}?`)) return;
    try { await api.promoteKnowledge(entry.id); load(); } catch (e) { alert(e.message); }
  }
  async function answerUnanswered(entry) {
    const answer = drafts[entry.id];
    if (!answer?.trim()) return;
    try {
      const saved = await api.updateKnowledge(entry.id, { answer, isActive: true });
      load();
      // Одразу пропонуємо розповсюдити щойно збережену відповідь на інші товари/категорії —
      // саме той крок, який власник просив не загублювати після відповіді на питання.
      setCopying(saved?.data || { ...entry, answer, isActive: true });
    } catch (e) { alert(e.message); }
  }
  async function skipUnanswered(entry) {
    if (!confirm('Це видалить питання без відповіді — воно зникне зі списку назавжди (нічого не збережеться). Продовжити?')) return;
    try { await api.deleteKnowledge(entry.id); load(); } catch (e) { alert(e.message); }
  }

  function newEntryDefaults() {
    if (lockProductId) return { kind: 'faq', scope: 'product', productId: lockProductId, tags: [], priority: 0, isActive: true };
    return { kind: 'faq', scope: scopeFilter || scopes[0], tags: [], priority: 0, isActive: true };
  }

  return (
    <div>
      <ErrorBanner message={error} />

      {!lockProductId && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Пошук у питаннях/відповідях…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="max-w-[160px]" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Усі типи</option>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {scopes.length > 1 && (
            <Select className="max-w-[180px]" value={scopeFilter} onChange={(e) => { setScopeFilter(e.target.value); setTargetFilter(''); }}>
              <option value="">Усі рівні ({scopes.map((s) => SCOPE_LABEL[s]).join(' / ')})</option>
              {scopes.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
            </Select>
          )}
          {effectiveScopes.length === 1 && effectiveScopes[0] === 'category' && (
            <Select className="max-w-[200px]" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
              <option value="">Усі категорії</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
          {effectiveScopes.length === 1 && effectiveScopes[0] === 'supplier' && (
            <Select className="max-w-[200px]" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
              <option value="">Усі постачальники</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          {effectiveScopes.length === 1 && effectiveScopes[0] === 'product' && (
            <Select className="max-w-[220px]" value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
              <option value="">Усі товари</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </Select>
          )}
          <Select className="max-w-[160px]" value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="">Активні й ні</option>
            <option value="true">Тільки активні</option>
            <option value="false">Тільки вимкнені</option>
          </Select>
        </div>
      )}

      {!creating && (
        <div className="mb-4">
          <Button type="button" onClick={() => setCreating(true)}>+ Нова відповідь</Button>
        </div>
      )}
      {creating && (
        <Card className="mb-4 p-4">
          <div className="mb-3 text-sm font-semibold text-slate-200">Нова відповідь</div>
          <EntryFields
            initial={newEntryDefaults()}
            categories={categories}
            suppliers={suppliers}
            products={products}
            allowedScopes={scopes}
            lockProductId={lockProductId}
            onCancel={() => setCreating(false)}
            onSave={saveEntry}
          />
        </Card>
      )}

      {unanswered.length > 0 && (
        <Card className="mb-4 border-amber-800/50 p-4">
          <div className="mb-3 text-xs font-medium uppercase text-amber-400">Потребують відповіді ({unanswered.length})</div>
          <div className="space-y-3">
            {unanswered.map((e) => (
              <div key={e.id} className="rounded-lg bg-slate-800/50 p-3">
                <div className="mb-2 text-sm font-medium">{e.question}</div>
                {e.product && <div className="mb-1 text-xs text-slate-500">Товар: {e.product.name}</div>}
                <Textarea rows={2} placeholder="Впишіть відповідь…" value={drafts[e.id] ?? ''} onChange={(ev) => setDrafts({ ...drafts, [e.id]: ev.target.value })} />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={() => answerUnanswered(e)} disabled={!drafts[e.id]?.trim()}>Відповісти й увімкнути</Button>
                  <Button type="button" variant="secondary" onClick={() => skipUnanswered(e)} title="Видалить це питання без відповіді назавжди — нічого не збережеться">Не потрібно (видалити питання)</Button>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  «Відповісти й увімкнути» збереже відповідь і одразу запропонує розповсюдити її на інші товари/категорії.
                  «Не потрібно» — це питання більше не задаватимуть, відповідь не зберігається.
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {normal.length === 0 ? (
        <EmptyState title="Записів ще немає" hint="Додайте першу відповідь вручну." />
      ) : (
        <Card>
          <div className="border-b border-slate-800 px-4 py-2 text-xs text-slate-500">
            📋 «Копіювати на інші» — та сама відповідь ще на кількох товарах/категоріях (окремі незалежні копії).
            ⬆️ «На категорію / На весь магазин» — перенести відповідь на вищий рівень, щоб не дублювати її на кожен товар.
          </div>
          {/* 2026-09-17 (власник): картка замість щільної таблиці — питання й відповідь раніше
              обрізались (max-w-xs truncate), тому схожі/дубльовані записи важко було відрізнити.
              Рядок 1 — питання на всю ширину, рядок 2 — відповідь на всю ширину, рядок 3 — решта
              (тип/рівень/теги/активність/дії). Той самий компонент — у «Загальних», «Категоріях» і
              «Товарах» однаково, бо це один спільний EntriesSection. */}
          <div>
            {normal.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                categories={categories}
                suppliers={suppliers}
                products={products}
                allowedScopes={scopes}
                lockProductId={lockProductId}
                onSave={saveEntry}
                onDelete={() => remove(e)}
                onToggleActive={() => toggleActive(e)}
                onCopy={() => setCopying(e)}
                onPromote={e.scope !== 'shop' ? () => promote(e) : null}
              />
            ))}
          </div>
        </Card>
      )}

      {copying && (
        <CopyModal
          entry={copying}
          categories={categories}
          suppliers={suppliers}
          products={products}
          onCancel={() => setCopying(null)}
          onDone={() => { setCopying(null); load(); }}
        />
      )}
    </div>
  );
}

// Той самий блок «Відповіді», вбудований у картку товару (ProductFormModal) — один рівень
// (product), без фільтрів, заблокований на конкретний товар.
export function ProductAnswersSection({ productId, categories, suppliers, products }) {
  return <EntriesSection scopes={['product']} categories={categories} suppliers={suppliers} products={products} lockProductId={productId} />;
}

// 2026-09-17 (власник: "прибери попап, зроби щоб все можна було редагувати інлайн") — колишній
// EntryFormModal (fixed-overlay попап) замінено на EntryRow: клік по рядку розгортає ті самі поля
// ПРЯМО під питанням/відповіддю, без модалки. EntryFields — спільний блок полів, використовується
// і тут (редагування існуючого запису), і в "+ Нова відповідь" (створення) у EntriesSection вище.
function EntryFields({ initial, categories, suppliers, products, allowedScopes, lockProductId, onCancel, onSave }) {
  const [form, setForm] = useState({ ...initial, tagsText: (initial.tags || []).join(', ') });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const scopeOptions = allowedScopes && allowedScopes.length ? allowedScopes : ['shop', 'category', 'supplier', 'product'];
  const canSave = form.answer?.trim()
    && !(!lockProductId && form.scope === 'category' && !form.categoryId)
    && !(!lockProductId && form.scope === 'supplier' && !form.supplierId)
    && !(!lockProductId && form.scope === 'product' && !form.productId);

  async function save() {
    setError(''); setSaving(true);
    try { await onSave({ ...form, tags: form.tagsText.split(',').map((t) => t.trim()).filter(Boolean) }); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <ErrorBanner message={error} />
      <div className="space-y-3">
        <Field label="Тип">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Питання клієнта (варіанти через |)"><Textarea rows={2} value={form.question || ''} onChange={(e) => setForm({ ...form, question: e.target.value })} /></Field>
        <Field label="Відповідь бота *"><Textarea rows={3} value={form.answer || ''} onChange={(e) => setForm({ ...form, answer: e.target.value })} /></Field>
        <Field label="Теги (через кому)"><Input value={form.tagsText} onChange={(e) => setForm({ ...form, tagsText: e.target.value })} /></Field>
        {!lockProductId && scopeOptions.length > 1 && (
          <Field label="Рівень">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, categoryId: '', supplierId: '', productId: '' })}>
              {scopeOptions.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
            </Select>
          </Field>
        )}
        {!lockProductId && form.scope === 'category' && (
          <Field label="Категорія">
            <Select value={form.categoryId || ''} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">— оберіть —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {!lockProductId && form.scope === 'supplier' && (
          <Field label="Постачальник">
            <Select value={form.supplierId || ''} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
              <option value="">— оберіть —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        {!lockProductId && form.scope === 'product' && (
          <Field label="Товар">
            <Select value={form.productId || ''} onChange={(e) => setForm({ ...form, productId: e.target.value })}>
              <option value="">— оберіть —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </Select>
          </Field>
        )}
        <Field label="Пріоритет (вище = раніше в промпті)"><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="button" onClick={save} disabled={!canSave || saving}>{saving ? 'Зберігаю…' : 'Зберегти'}</Button>
      </div>
    </div>
  );
}

// Один запис: у режимі перегляду — питання/відповідь/метадані як і раніше; клік розгортає ті самі
// поля інлайн (EntryFields) замість попапу.
function EntryRow({ entry, categories, suppliers, products, allowedScopes, lockProductId, onSave, onDelete, onToggleActive, onCopy, onPromote }) {
  const [editing, setEditing] = useState(false);

  async function handleSave(form) {
    await onSave({ ...entry, ...form });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="border-b border-slate-800/60 bg-slate-800/30 px-4 py-3 last:border-0">
        <EntryFields
          initial={entry}
          categories={categories}
          suppliers={suppliers}
          products={products}
          allowedScopes={allowedScopes}
          lockProductId={lockProductId}
          onCancel={() => setEditing(false)}
          onSave={handleSave}
        />
      </div>
    );
  }

  // 2026-09-17 (власник: "виводь також фото товару, такого ж розміру як в списку товарів") —
  // Thumb — той САМИЙ спільний компонент (h-28 w-28), що й на сторінках "Товари"/"Комплекти",
  // тож розмір і вигляд мініатюри однакові скрізь. Показуємо лише для записів рівня "товар".
  return (
    <div onClick={() => setEditing(true)} className="flex cursor-pointer gap-4 border-b border-slate-800/60 px-4 py-3 last:border-0 hover:bg-slate-800/40">
      {entry.scope === 'product' && <Thumb url={entry.product?.thumbnailUrl} />}
      <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-slate-100">{entry.question || '—'}</div>
      <div className="mt-1 text-sm text-slate-400">{entry.answer}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge color={KIND_COLOR[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>
        {!lockProductId && (
          <span className="text-xs text-slate-500">
            {entry.scope === 'shop' ? 'Магазин' : entry.scope === 'category' ? (entry.category?.name || 'Категорія') : entry.scope === 'supplier' ? (entry.supplier?.name || 'Постачальник') : (entry.product?.name || 'Товар')}
          </span>
        )}
        {entry.tags?.length > 0 && <span className="text-xs text-slate-500">🏷 {entry.tags.join(', ')}</span>}
        <button type="button" onClick={(ev) => { ev.stopPropagation(); onToggleActive(); }}>
          <Badge color={entry.isActive ? 'green' : 'slate'}>{entry.isActive ? 'Активний' : 'Вимкнений'}</Badge>
        </button>
        <div className="ml-auto flex flex-wrap justify-end gap-1 whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
          <button
            type="button"
            onClick={onCopy}
            title="Використати цю ж відповідь ще на кількох товарах/категоріях/постачальниках (незалежні копії)"
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            📋 Копіювати на інші
          </button>
          {onPromote && (
            <button
              type="button"
              onClick={onPromote}
              title="Перенести цю відповідь на вищий рівень (одна відповідь замість окремої на кожен товар)"
              className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              ⬆️ {entry.scope === 'product' ? 'На категорію' : 'На весь магазин'}
            </button>
          )}
          <IconButton type="button" onClick={onDelete} title="Видалити">🗑️</IconButton>
        </div>
      </div>
      </div>
    </div>
  );
}

// ── Копіювати відповідь на інші товари/категорії/постачальники (незалежні копії) ─
function CopyModal({ entry, categories, suppliers, products, onCancel, onDone }) {
  const [rows, setRows] = useState([{ scope: 'product', id: '' }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function updateRow(i, field, value) {
    setRows(rows.map((r, idx) => (idx === i ? { ...r, [field]: value, ...(field === 'scope' ? { id: '' } : {}) } : r)));
  }
  function addRow() { setRows([...rows, { scope: 'product', id: '' }]); }
  function removeRow(i) { setRows(rows.filter((_, idx) => idx !== i)); }

  function optionsFor(scope) {
    if (scope === 'category') return categories;
    if (scope === 'supplier') return suppliers;
    return products.map((p) => ({ id: p.id, name: `${p.name} (${p.sku})` }));
  }

  async function submit() {
    setError('');
    const targets = rows.filter((r) => r.id).map((r) => ({
      scope: r.scope,
      categoryId: r.scope === 'category' ? r.id : undefined,
      supplierId: r.scope === 'supplier' ? r.id : undefined,
      productId: r.scope === 'product' ? r.id : undefined,
    }));
    if (!targets.length) { setError('Оберіть хоча б одну ціль'); return; }
    setSaving(true);
    try { await api.copyKnowledge(entry.id, targets); onDone(); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-16" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-sm font-semibold">Розповсюдити цю відповідь ще на щось?</h3>
        <p className="mb-1 text-xs text-slate-400">«{entry.question || entry.answer}»</p>
        <p className="mb-4 text-xs text-slate-500">Створює незалежну копію цієї відповіді на обраних цілях (наприклад ще на 3 інші кофти) — редагування копії ніяк не впливає на оригінал. Якщо зараз не треба — просто натисніть «Скасувати», відповідь уже збережена.</p>
        <ErrorBanner message={error} />
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2">
              <Select className="max-w-[140px]" value={row.scope} onChange={(e) => updateRow(i, 'scope', e.target.value)}>
                <option value="category">Категорія</option>
                <option value="supplier">Постачальник</option>
                <option value="product">Товар</option>
              </Select>
              <Select className="flex-1" value={row.id} onChange={(e) => updateRow(i, 'id', e.target.value)}>
                <option value="">— оберіть —</option>
                {optionsFor(row.scope).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
              <IconButton type="button" onClick={() => removeRow(i)}>🗑️</IconButton>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" className="mt-2" onClick={addRow}>+ Ще ціль</Button>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
          <Button type="button" onClick={submit} disabled={saving}>{saving ? 'Копіюю…' : 'Копіювати'}</Button>
        </div>
      </div>
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
