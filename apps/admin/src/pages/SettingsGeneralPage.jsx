// §9.16 Налаштування — Загальні: назва магазину, API-ключ (показати/перегенерувати),
// + фінансові вхідні для щоденної аналітики (курс, постійні витрати, ЗП).
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Field, Input, Button, ErrorBanner } from '../components/common/Common';

export default function SettingsGeneralPage() {
  const [tenant, setTenant] = useState(null);
  const [name, setName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [finance, setFinance] = useState({ usdExchangeRate: '', dailyFixedCosts: '', dailyPayrollCosts: '' });
  const [financeSaved, setFinanceSaved] = useState(false);

  async function load() {
    try {
      const { data } = await api.getTenantSettings();
      setTenant(data); setName(data.name);
      setFinance({
        usdExchangeRate: data.usdExchangeRate ?? '',
        dailyFixedCosts: data.dailyFixedCosts ?? '',
        dailyPayrollCosts: data.dailyPayrollCosts ?? '',
      });
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    setError(''); setSaved(false);
    try { await api.updateTenantSettings({ name }); setSaved(true); load(); } catch (e) { setError(e.message); }
  }

  async function saveFinance() {
    setError(''); setFinanceSaved(false);
    try {
      await api.updateTenantSettings({
        usdExchangeRate: finance.usdExchangeRate === '' ? null : Number(finance.usdExchangeRate),
        dailyFixedCosts: finance.dailyFixedCosts === '' ? null : Number(finance.dailyFixedCosts),
        dailyPayrollCosts: finance.dailyPayrollCosts === '' ? null : Number(finance.dailyPayrollCosts),
      });
      setFinanceSaved(true);
    } catch (e) { setError(e.message); }
  }

  async function regenerate() {
    if (!confirm('Перегенерувати API-ключ? Стару воронку/MCP-конектор доведеться оновити новим ключем.')) return;
    try { const { data } = await api.regenerateApiKey(); setTenant({ ...tenant, apiKey: data.apiKey }); } catch (e) { setError(e.message); }
  }

  if (!tenant) return null;

  return (
    <div className="space-y-5">
      <PageHeader title="Налаштування — Загальні" />
      <ErrorBanner message={error} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Фінансові параметри для щоденної аналітики</h3>
          <p className="mb-3 text-xs text-slate-500">Вручну оновлювані значення — курс міняється щодня/щотижня, постійні витрати/ЗП зазвичай стабільні по місяцю.</p>
          <Field label="Курс долара, грн"><Input type="number" step="0.01" value={finance.usdExchangeRate} onChange={(e) => setFinance({ ...finance, usdExchangeRate: e.target.value })} /></Field>
          <Field label="Постійні витрати за добу, $"><Input type="number" step="0.01" value={finance.dailyFixedCosts} onChange={(e) => setFinance({ ...finance, dailyFixedCosts: e.target.value })} /></Field>
          <Field label="Витрати на оплату праці за добу, $"><Input type="number" step="0.01" value={finance.dailyPayrollCosts} onChange={(e) => setFinance({ ...finance, dailyPayrollCosts: e.target.value })} /></Field>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={saveFinance}>Зберегти</Button>
            {financeSaved && <span className="text-xs text-emerald-400">Збережено</span>}
          </div>
        </Card>
      </div>
    </div>
  );
}
