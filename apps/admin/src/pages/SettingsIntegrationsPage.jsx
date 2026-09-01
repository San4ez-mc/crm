// §9.17 Налаштування — Інтеграції: (1) робочі картки Zernio/Нова Пошта/Webhook,
// (2) інформаційний каталог УСІХ інтеграцій, які реально використовуються у воронках
// FINEKO Flows для збору аналітики та роботи ШІ-агентів (не для редагування тут —
// самі ключі живуть у "Ключі API"; це каталог "що є і навіщо").
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Field, Input, Button, ErrorBanner, Badge } from '../components/common/Common';

// Джерело: список збережених конекторів FINEKO Flows (список типів стабільний,
// оновлювати вручну при появі нового типу конектора в /connectors воронок).
// logoSlug — https://cdn.simpleicons.org/<slug> (бренд-іконка); якщо не завантажиться
// або slug відсутній — падаємо на emoji-бейдж кольору сервісу (див. IntegrationLogo).
const INTEGRATION_GROUPS = [
  {
    title: 'ШІ-моделі (аналіз, діалоги, генерація тексту)',
    items: [
      { name: 'Claude (Anthropic)', desc: 'Основна модель для діалогів з клієнтами, аналізу замовлень і прийняття рішень у воронках.', logoSlug: 'anthropic', icon: '🎭', color: '#7C3AED' },
      { name: 'OpenAI GPT-4', desc: 'Резервна модель, якщо Claude тимчасово недоступний.', logoSlug: 'openai', icon: '🤖', color: '#059669' },
      { name: 'Google Gemini', desc: 'Другий резервний провайдер + мультимодальний аналіз (фото товарів).', logoSlug: 'googlegemini', icon: '✨', color: '#4285F4' },
      { name: 'Google Vertex AI', desc: 'Гугл-інфраструктура для Gemini/Imagen через сервісний акаунт.', logoSlug: 'googlecloud', icon: '🌐', color: '#4285F4' },
      { name: 'Hugging Face', desc: 'Доступ до відкритих моделей для другорядних задач.', logoSlug: 'huggingface', icon: '🤗', color: '#FF9D00' },
      { name: 'Together AI', desc: 'Хмарний запуск відкритих LLM/генеративних моделей.', logoSlug: null, icon: '🤝', color: '#3B82F6' },
      { name: 'Replicate', desc: 'Запуск open-source моделей для зображень і відео.', logoSlug: 'replicate', icon: '🔁', color: '#000000' },
      { name: 'Stability AI', desc: 'Stable Diffusion — художні стилі та ілюстрації.', logoSlug: 'stabilityai', icon: '🎭', color: '#8E44AD' },
    ],
  },
  {
    title: 'Медіа та контент',
    items: [
      { name: 'ElevenLabs', desc: 'Синтез мовлення для озвучення відео та аватарів.', logoSlug: 'elevenlabs', icon: '🎙️', color: '#F97316' },
      { name: 'HeyGen', desc: 'Відео з цифровим аватаром за сценарієм.', logoSlug: null, icon: '🎬', color: '#8B5CF6' },
      { name: 'Fal.ai', desc: 'Генерація зображень/відео (FLUX, Kling).', logoSlug: null, icon: '🎨', color: '#8B5CF6' },
      { name: 'Google Imagen 3', desc: 'Реалістичні фото та ілюстрації за промптом.', logoSlug: 'google', icon: '🎨', color: '#4285F4' },
      { name: 'Google Veo 2', desc: 'Генерація відео з тексту/зображення.', logoSlug: 'google', icon: '🎬', color: '#34A853' },
      { name: 'Cloudflare Workers AI', desc: 'AI-інференс на edge (FLUX, Llama) без окремого сервера.', logoSlug: 'cloudflare', icon: '☁️', color: '#F6821F' },
      { name: 'Cloudflare R2', desc: 'Сховище відео/фото з публічним CDN.', logoSlug: 'cloudflare', icon: '☁️', color: '#F6821F' },
      { name: 'Unsplash', desc: 'Безкоштовні фото для контенту.', logoSlug: 'unsplash', icon: '📷', color: '#111827' },
      { name: 'Pexels', desc: 'Безкоштовні фото та відео (B-roll).', logoSlug: 'pexels', icon: '🎞️', color: '#05A081' },
      { name: 'Pixabay', desc: 'Фото, ілюстрації, відео без ліцензійних обмежень.', logoSlug: 'pixabay', icon: '🌅', color: '#2EC66C' },
    ],
  },
  {
    title: 'Реклама та аналітика',
    items: [
      { name: 'Meta Ads (Facebook/Instagram)', desc: 'Щоденні витрати/покази/кліки по оголошеннях — крон-воронка пише напряму в CRM.', logoSlug: 'meta', icon: '📊', color: '#0866FF' },
      { name: 'Facebook Pixel + CAPI', desc: 'Події Lead/Purchase для оптимізації реклами.', logoSlug: 'meta', icon: '📈', color: '#0866FF' },
      { name: 'Нова Пошта', desc: 'Статуси ТТН — окремий крон-flow пише назад у CRM.', logoSlug: null, icon: '📦', color: '#DA291C' },
      { name: 'Zernio', desc: 'Агрегатор рекламних кабінетів (див. картку нижче).', logoSlug: null, icon: '📡', color: '#0EA5E9' },
    ],
  },
  {
    title: 'Платежі та комунікація',
    items: [
      { name: 'Telegram Bot API', desc: 'Канал спілкування з клієнтами і сповіщення менеджеру.', logoSlug: 'telegram', icon: '✈️', color: '#0088CC' },
      { name: 'WayForPay', desc: 'Інвойси та webhook-події оплати.', logoSlug: null, icon: '💳', color: '#2563EB' },
      { name: 'Monobank', desc: 'Звірка надходжень ФОП з Open API.', logoSlug: 'monobank', icon: '🏦', color: '#000000' },
      { name: 'IBAN Оплата', desc: 'Прийом оплат за реквізитами ФОП.', logoSlug: null, icon: '💳', color: '#111827' },
      { name: 'Google Sheets', desc: 'Читання/запис таблиць (звіти, довідники).', logoSlug: 'googlesheets', icon: '📊', color: '#1E7E34' },
      { name: 'Google Apps Script', desc: 'Автоматизація таблиць/пошти/календаря.', logoSlug: 'googleappsscript', icon: '📝', color: '#3B82F6' },
    ],
  },
];

function IntegrationLogo({ slug, icon, color }) {
  return (
    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ backgroundColor: color + '22' }}>
      {slug && (
        <img
          src={`https://cdn.simpleicons.org/${slug}`}
          alt=""
          className="h-6 w-6"
          style={{ filter: 'none' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling.style.display = 'flex'; }}
        />
      )}
      <span className="text-lg leading-none" style={{ display: slug ? 'none' : 'flex' }}>{icon}</span>
    </div>
  );
}

export default function SettingsIntegrationsPage() {
  const [tenant, setTenant] = useState(null);
  const [ads, setAds] = useState([]);
  const [npKey, setNpKey] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const [t, z] = await Promise.all([api.getTenantSettings(), api.zernioStatus()]);
      setTenant(t.data); setNpKey(t.data.novaPoshtaApiKey || ''); setAds(z.data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function saveNp() {
    setSaved(false);
    try { await api.updateTenantSettings({ novaPoshtaApiKey: npKey }); setSaved(true); } catch (e) { setError(e.message); }
  }

  if (!tenant) return null;
  const apiBase = window.location.origin.replace(/:\d+$/, ':4700');

  return (
    <div className="space-y-6">
      <PageHeader title="Налаштування — Інтеграції" />
      <ErrorBanner message={error} />
      <p className="max-w-3xl text-sm text-slate-400">
        Це інтеграції, які використовує вся екосистема FINEKO для збору аналітики
        (реклама, доставка, платежі) і для роботи ШІ-агентів у воронках продажів
        та контенту. Самі ключі/токени редагуються на сторінці <a href="/settings/keys" className="text-brand-light hover:underline">«Ключі API»</a> —
        тут лише довідковий каталог: що є і для чого використовується.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Zernio (рекламні кабінети)</h3>
          <p className="mb-3 text-xs text-slate-500">Підключення й синхронізація йде через окрему автоматизацію FINEKO Flows — тут лише стан того, що вже прийшло.</p>
          {ads.length === 0 ? (
            <div className="text-sm text-slate-500">Кабінетів ще не підключено.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="pb-1">Оголошення</th><th className="pb-1">Синхр.</th></tr></thead>
              <tbody>
                {ads.map((a) => (
                  <tr key={a.id} className="border-t border-slate-800/60">
                    <td className="py-1.5">{a.name || a.externalId}</td>
                    <td className="py-1.5">{a.lastSyncedAt ? <Badge color="green">{new Date(a.lastSyncedAt).toLocaleDateString('uk-UA')}</Badge> : <Badge color="amber">ще ні</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Нова Пошта</h3>
          <p className="mb-3 text-xs text-slate-500">Статуси ТТН опитує окремий крон-flow цим ключем і пише назад через PATCH /orders/:id/ttn-status.</p>
          <Field label="API-ключ Нової Пошти">
            <div className="flex gap-2">
              <Input type="password" value={npKey} onChange={(e) => setNpKey(e.target.value)} />
              <Button onClick={saveNp}>Зберегти</Button>
            </div>
          </Field>
          {saved && <span className="text-xs text-emerald-400">Збережено</span>}
        </Card>

        <Card className="p-5">
          <h3 className="mb-1 text-sm font-semibold">Webhook воронки</h3>
          <p className="mb-2 text-xs text-slate-500">Встав ці значення у funnelKey воронки (аналог TELEGRAM_CONNECTOR_ID) — секрет лишається в ключах воронки, не тут.</p>
          <Field label="CRM_API_URL"><Input readOnly value={apiBase} /></Field>
          <Field label="CRM_API_KEY (Tenant.apiKey)"><Input readOnly value={tenant.apiKey} /></Field>
        </Card>
      </div>

      <div className="space-y-6">
        {INTEGRATION_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{group.title}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.items.map((it) => (
                <Card key={it.name} className="flex items-start gap-3 p-4">
                  <IntegrationLogo slug={it.logoSlug} icon={it.icon} color={it.color} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{it.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{it.desc}</div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
