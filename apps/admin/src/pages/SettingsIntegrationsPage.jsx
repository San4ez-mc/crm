// §9.17 Налаштування — Інтеграції: Zernio (через Flows), Нова Пошта, Webhook воронки.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Field, Input, Button, ErrorBanner, Badge } from '../components/common/Common';

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
    <div className="max-w-2xl space-y-5">
      <PageHeader title="Налаштування — Інтеграції" />
      <ErrorBanner message={error} />

      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Zernio (рекламні кабінети)</h3>
        <p className="mb-3 text-xs text-slate-500">Підключення й синхронізація йде через окрему автоматизацію FINEKO Flows — тут лише стан того, що вже прийшло.</p>
        {ads.length === 0 ? (
          <div className="text-sm text-slate-500">Кабінетів ще не підключено.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="pb-1">Оголошення</th><th className="pb-1">Остання синхронізація</th></tr></thead>
            <tbody>
              {ads.map((a) => (
                <tr key={a.id} className="border-t border-slate-800/60">
                  <td className="py-1.5">{a.name || a.externalId}</td>
                  <td className="py-1.5">{a.lastSyncedAt ? <Badge color="green">{new Date(a.lastSyncedAt).toLocaleDateString('uk-UA')}</Badge> : <Badge color="amber">ще не синхронізовано</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Нова Пошта</h3>
        <p className="mb-3 text-xs text-slate-500">Статуси ТТН опитує окремий крон-flow FINEKO Flows цим ключем і пише назад через PATCH /orders/:id/ttn-status.</p>
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
  );
}
