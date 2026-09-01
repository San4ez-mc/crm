// "Автоматизації" — обʼєднує три колишні сторінки (Інтеграції, Ключі API, ФОПи) в одну.
// Каталог сервісів звужений до РЕАЛЬНО використовуваних у двох продакшн-воронках цього
// магазину (insta-covercar-ua / insta-goverla-shop — Instagram-продажі; meta-ads-sync-* —
// щоденний крон реклами) — перевірено напряму по funnelKey цих ботів 2026-09-01, а не
// "усе, що взагалі підтримує Flows". key-коди навмисно збігаються 1:1 з назвами funnelKey
// воронки, щоб майбутня синхронізація (кнопка "Синхронізувати в воронку") була тривіальною:
// {key,value} з TenantSecret напряму в PUT /api/funnels/:botId/keys.
// Постачальницькі ключі (BrewDrop/EasyDrop) — на сторінці Постачальники, не тут.
// Синхронізація реклами і Webhook-креденшли — на сторінках Оголошення / Загальні.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Field, Input, Button, IconButton, ErrorBanner } from '../components/common/Common';
import Modal from '../components/common/Modal';

const SERVICE_GROUPS = [
  {
    title: 'Instagram / Meta Ads',
    icon: '📊', color: '#0866FF', logoSlug: 'meta',
    desc: 'Канал продажів (Direct-повідомлення з реклами) і щоденна статистика витрат/показів/кліків.',
    keys: [
      { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Page/IG Access Token', isSecret: true },
      { key: 'INSTAGRAM_BUSINESS_ID', label: 'Instagram Business ID', isSecret: false },
      { key: 'INSTAGRAM_USERNAME', label: 'Username (без @)', isSecret: false },
      { key: 'INSTAGRAM_VERIFY_TOKEN', label: 'Verify Token (webhook)', isSecret: true },
      { key: 'META_SYSTEM_USER_TOKEN', label: 'Meta System User Token', isSecret: true },
      { key: 'META_AD_ACCOUNT_ID', label: 'Ad Account ID (act_...)', isSecret: false },
    ],
  },
  {
    title: 'Zernio',
    icon: '📡', color: '#0EA5E9', logoSlug: null,
    desc: 'Транспорт Instagram-повідомлень без Meta App Review.',
    keys: [
      { key: 'ZERNIO_ACCOUNT_ID', label: 'Account ID', isSecret: false },
      { key: 'ZERNIO_API_TOKEN', label: 'API Token', isSecret: true },
      { key: 'ZERNIO_SEND_URL', label: 'URL відправки', isSecret: false },
    ],
  },
  {
    title: 'KeyCRM',
    icon: '🗂️', color: '#F59E0B', logoSlug: null,
    desc: 'Каталог товарів для воронки (тимчасово — до повного переходу воронки на Fineko CRM).',
    keys: [
      { key: 'KEYCRM_API_TOKEN', label: 'API Token', isSecret: true },
    ],
  },
  {
    title: 'Оплата',
    icon: '💳', color: '#2563EB', logoSlug: null,
    desc: 'Прийом оплат і звірка надходжень (IBAN-посилання + виписка Monobank).',
    keys: [
      { key: 'IBANOPLATA_API_KEY', label: 'IbanOplata — API Key', isSecret: true },
      { key: 'MONO_TOKEN', label: 'Monobank — X-Token', isSecret: true },
      { key: 'MONO_ACCOUNT_ID', label: 'Monobank — id рахунку', isSecret: false },
    ],
  },
  {
    title: 'Telegram',
    icon: '✈️', color: '#0088CC', logoSlug: 'telegram',
    desc: 'Бот-канал і сповіщення менеджеру.',
    keys: [
      { key: 'TELEGRAM_BOT_TOKEN', label: 'Bot Token', isSecret: true },
      { key: 'ADMIN_TELEGRAM_ID', label: 'Telegram ID менеджера (сповіщення)', isSecret: false },
    ],
  },
  {
    title: 'ШІ та FAQ',
    icon: '✨', color: '#4285F4', logoSlug: 'googlegemini',
    desc: 'Резервний аналіз фото/скріншотів і база готових відповідей на типові питання.',
    keys: [
      { key: 'GEMINI_API_KEY', label: 'Gemini API Key (vision fallback)', isSecret: true },
      { key: 'VECTOR_TOKEN', label: 'Вектор-база FAQ — токен', isSecret: true },
      { key: 'VECTOR_URL', label: 'Вектор-база FAQ — URL', isSecret: false },
    ],
  },
];

function ServiceLogo({ slug, icon, color }) {
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ backgroundColor: color + '22' }}>
      {slug && (
        <img src={`https://cdn.simpleicons.org/${slug}`} alt="" className="h-5 w-5"
          onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'flex'; }} />
      )}
      <span className="text-base leading-none" style={{ display: slug ? 'none' : 'flex' }}>{icon}</span>
    </div>
  );
}

function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${'•'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`;
}

export default function AutomationsPage() {
  const [secrets, setSecrets] = useState(null);
  const [fops, setFops] = useState(null);
  const [npKey, setNpKey] = useState('');
  const [npSaved, setNpSaved] = useState(false);
  const [error, setError] = useState('');
  const [editingSecret, setEditingSecret] = useState(null); // {id?, key, label, value, isSecret}
  const [editingFop, setEditingFop] = useState(null);

  async function load() {
    setError('');
    try {
      const [s, f, t] = await Promise.all([api.listSecrets(), api.listFops(), api.getTenantSettings()]);
      setSecrets(s.data); setFops(f.data); setNpKey(t.data.novaPoshtaApiKey || '');
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function saveNp() {
    setNpSaved(false);
    try { await api.updateTenantSettings({ novaPoshtaApiKey: npKey }); setNpSaved(true); } catch (e) { setError(e.message); }
  }

  const byKey = Object.fromEntries((secrets || []).map((s) => [s.key, s]));

  async function openSecret(known) {
    const existing = byKey[known.key];
    if (!existing) { setEditingSecret({ key: known.key, label: known.label, value: '', isSecret: known.isSecret }); return; }
    try { setEditingSecret((await api.getSecret(existing.id)).data); } catch (e) { setError(e.message); }
  }
  async function saveSecret(form) {
    try {
      if (form.id) await api.updateSecret(form.id, form);
      else await api.createSecret(form);
      setEditingSecret(null);
      load();
    } catch (e) { setError(e.message); }
  }
  async function deleteSecret(id) {
    if (!confirm('Видалити значення ключа?')) return;
    try { await api.deleteSecret(id); load(); } catch (e) { alert(e.message); }
  }

  async function saveFop(form) {
    try {
      if (form.id) await api.updateFop(form.id, form);
      else await api.createFop(form);
      setEditingFop(null);
      load();
    } catch (e) { setError(e.message); }
  }
  async function deleteFop(id) {
    if (!confirm('Видалити ФОП?')) return;
    try { await api.deleteFop(id); load(); } catch (e) { alert(e.message); }
  }
  async function activateFop(id) {
    try { await api.activateFop(id); load(); } catch (e) { alert(e.message); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Автоматизації" />
      <ErrorBanner message={error} />
      <p className="max-w-3xl text-sm text-slate-400">
        Усі ключі й сервіси, які реально використовує ваша Instagram-воронка продажів і
        щоденний крон реклами — в одному місці. Заповніть тут — і це буде звідки підтягувати
        значення у воронку (кнопка синхронізації додається окремо для кожного сервісу за потреби).
      </p>

      {/* ── ФОП ─────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">ФОП (юрособи для прийому оплат)</h3>
          <Button variant="secondary" onClick={() => setEditingFop({})}>+ ФОП</Button>
        </div>
        {fops === null ? null : fops.length === 0 ? (
          <p className="text-sm text-slate-500">ФОПів ще немає.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-800 text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Активний</th><th className="py-2">Назва</th><th className="py-2">IBAN</th><th className="py-2">ІПН</th><th className="py-2">Monobank</th><th className="py-2"></th></tr>
            </thead>
            <tbody>
              {fops.map((f) => (
                <tr key={f.id} className={`border-b border-slate-800/60 last:border-0 ${f.isActive ? 'bg-brand/5' : ''}`}>
                  <td className="py-2"><input type="radio" name="active-fop" checked={!!f.isActive} onChange={() => activateFop(f.id)} title="Зробити активним" /></td>
                  <td className="py-2">{f.name} {f.isActive && <span className="ml-1 rounded bg-brand/20 px-1.5 py-0.5 text-[10px] text-brand-light">активний</span>}</td>
                  <td className="py-2 text-slate-400">{f.iban || '—'}</td>
                  <td className="py-2 text-slate-400">{f.taxId || '—'}</td>
                  <td className="py-2 text-slate-400">{f.monobankToken ? '✓ задано' : '—'}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      <IconButton onClick={() => setEditingFop(f)}>✏️</IconButton>
                      <IconButton onClick={() => deleteFop(f.id)}>🗑️</IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* ── Нова Пошта ──────────────────────────────────────────────── */}
      <Card className="max-w-md p-5">
        <h3 className="mb-1 text-sm font-semibold">Нова Пошта</h3>
        <p className="mb-3 text-xs text-slate-500">Статуси ТТН опитує окремий крон-flow цим ключем і пише назад через PATCH /orders/:id/ttn-status.</p>
        <Field label="API-ключ Нової Пошти">
          <div className="flex gap-2">
            <Input type="password" value={npKey} onChange={(e) => setNpKey(e.target.value)} />
            <Button onClick={saveNp}>Зберегти</Button>
          </div>
        </Field>
        {npSaved && <span className="text-xs text-emerald-400">Збережено</span>}
      </Card>

      {/* ── Ключі по сервісах ───────────────────────────────────────── */}
      <div className="space-y-5">
        {SERVICE_GROUPS.map((group) => (
          <Card key={group.title} className="p-5">
            <div className="mb-3 flex items-start gap-3">
              <ServiceLogo slug={group.logoSlug} icon={group.icon} color={group.color} />
              <div>
                <h3 className="text-sm font-semibold">{group.title}</h3>
                <p className="text-xs text-slate-500">{group.desc}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.keys.map((k) => {
                const existing = byKey[k.key];
                return (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => openSecret(k)}
                    className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-left text-sm hover:border-brand"
                  >
                    <div className="min-w-0">
                      <div className="truncate">{k.label}</div>
                      <div className="truncate font-mono text-xs text-slate-500">{existing ? (k.isSecret ? mask(existing.value) : existing.value) : '— не задано —'}</div>
                    </div>
                    {existing
                      ? <IconButton onClick={(e) => { e.stopPropagation(); deleteSecret(existing.id); }}>🗑️</IconButton>
                      : <span className="shrink-0 text-xs text-slate-600">+</span>}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <Modal isOpen={!!editingSecret} title={editingSecret?.id ? 'Редагувати ключ' : 'Задати ключ'} onClose={() => setEditingSecret(null)}>
        {editingSecret && <SecretForm initial={editingSecret} onSave={saveSecret} onCancel={() => setEditingSecret(null)} />}
      </Modal>
      <Modal isOpen={!!editingFop} title={editingFop?.id ? 'Редагувати ФОП' : 'Новий ФОП'} onClose={() => setEditingFop(null)}>
        {editingFop && <FopForm initial={editingFop} onSave={saveFop} onCancel={() => setEditingFop(null)} />}
      </Modal>
    </div>
  );
}

function SecretForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id, key: initial.key, label: initial.label || '', value: initial.value || '',
    isSecret: initial.isSecret !== undefined ? initial.isSecret : true,
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Ключ"><Input disabled value={form.key} className="font-mono text-xs" /></Field>
      <Field label="Значення"><Input required autoFocus value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}

function FopForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id, name: initial.name || '', iban: initial.iban || '', taxId: initial.taxId || '', monobankToken: initial.monobankToken || '',
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(form); }}>
      <Field label="Назва / ПІБ ФОП"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="IBAN"><Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="UA…" /></Field>
      <Field label="ІПН"><Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} /></Field>
      <Field label="Токен Monobank API"><Input value={form.monobankToken} onChange={(e) => setForm({ ...form, monobankToken: e.target.value })} placeholder="для звірки надходжень" /></Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Скасувати</Button>
        <Button type="submit">Зберегти</Button>
      </div>
    </form>
  );
}
