// §9.16 Налаштування — Загальні: назва магазину, API-ключ (показати/перегенерувати).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Field, Input, Button, ErrorBanner } from '../components/common/Common';

export default function SettingsGeneralPage() {
  const [tenant, setTenant] = useState(null);
  const [name, setName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    try { const { data } = await api.getTenantSettings(); setTenant(data); setName(data.name); } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setError(''); setSaved(false);
    try { await api.updateTenantSettings({ name }); setSaved(true); load(); } catch (e) { setError(e.message); }
  }

  async function regenerate() {
    if (!confirm('Перегенерувати API-ключ? Стару воронку/MCP-конектор доведеться оновити новим ключем.')) return;
    try { const { data } = await api.regenerateApiKey(); setTenant({ ...tenant, apiKey: data.apiKey }); } catch (e) { setError(e.message); }
  }

  if (!tenant) return null;

  return (
    <div className="max-w-lg">
      <PageHeader title="Налаштування — Загальні" />
      <ErrorBanner message={error} />
      <Card className="p-5">
        <Field label="Назва магазину"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={save}>Зберегти</Button>
          {saved && <span className="text-xs text-emerald-400">Збережено</span>}
        </div>

        <div className="mt-6 border-t border-slate-800 pt-5">
          <Field label="API-ключ для воронки">
            <div className="flex gap-2">
              <Input readOnly value={showKey ? tenant.apiKey : '•'.repeat(24)} />
              <Button variant="secondary" onClick={() => setShowKey(!showKey)}>{showKey ? 'Приховати' : 'Показати'}</Button>
            </div>
          </Field>
          <Button variant="danger" onClick={regenerate}>Перегенерувати ключ</Button>
        </div>
      </Card>
    </div>
  );
}
