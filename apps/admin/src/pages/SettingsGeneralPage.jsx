// §9.16 Налаштування — Загальні: назва магазину, API-ключ (показати/перегенерувати),
// + фінансові вхідні для щоденної аналітики (курс, постійні витрати, ЗП)
// + розміри за замовчуванням (2026-10-18): загальна сітка магазину й межі для категорій/товарів без власних.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Field, Input, Button, ErrorBanner, formatDateTime } from '../components/common/Common';
import SizeFitEditor, { fitChartToRows } from '../components/common/SizeFitEditor';

export default function SettingsGeneralPage() {
  const [tenant, setTenant] = useState(null);
  const [name, setName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [finance, setFinance] = useState({ usdExchangeRate: '', dailyFixedCosts: '', dailyPayrollCosts: '' });
  const [financeSaved, setFinanceSaved] = useState(false);
  const [refreshingRate, setRefreshingRate] = useState(false);
  const [fitRows, setFitRows] = useState([]);
  const [sizeRules, setSizeRules] = useState([]);
  const [sizesSaved, setSizesSaved] = useState(false);

  async function load() {
    try {
      const { data } = await api.getTenantSettings();
      setTenant(data); setName(data.name);
      setFinance({
        usdExchangeRate: data.usdExchangeRate ?? '',
        dailyFixedCosts: data.dailyFixedCosts ?? '',
        dailyPayrollCosts: data.dailyPayrollCosts ?? '',
      });
      setFitRows(fitChartToRows(data.fitChart)); setSizeRules(Array.isArray(data.sizeRules) ? data.sizeRules : []);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function refreshRate() {
    setError(''); setRefreshingRate(true);
    try { await api.refreshExchangeRate(); await load(); }
    catch (e) { setError('Не вдалось отримати курс з НБУ: ' + e.message); }
    finally { setRefreshingRate(false); }
  }

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

  async function saveSizes() {
    setError(''); setSizesSaved(false);
    try { await api.updateTenantSettings({ fitChart: fitRows.length ? fitRows : null, sizeRules }); setSizesSaved(true); load(); }
    catch (e) { setError(e.message); }
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
          <p className="mb-3 text-xs text-slate-500">
            Курс долара підтягується автоматично з Нацбанку (раз на 12 год) — рекламний бюджет із Meta
            приходить у доларах, а вся інша аналітика (виручка/маржа/прибуток) — у гривнях, тож без
            курсу цифри змішувались би. Постійні витрати/ЗП — стабільні по місяцю, вводяться вручну і
            вже в гривнях.
          </p>
          <Field label="Курс долара, грн">
            <div className="flex gap-2">
              <Input type="number" step="0.0001" value={finance.usdExchangeRate} onChange={(e) => setFinance({ ...finance, usdExchangeRate: e.target.value })} />
              <Button type="button" variant="secondary" onClick={refreshRate} disabled={refreshingRate}>{refreshingRate ? 'Оновлюю…' : 'Оновити з НБУ'}</Button>
            </div>
            {tenant.usdExchangeRateUpdatedAt && (
              <p className="mt-1 text-xs text-slate-500">Оновлено: {formatDateTime(tenant.usdExchangeRateUpdatedAt)}</p>
            )}
          </Field>
          <Field label="Постійні витрати за добу, грн"><Input type="number" step="0.01" value={finance.dailyFixedCosts} onChange={(e) => setFinance({ ...finance, dailyFixedCosts: e.target.value })} /></Field>
          <Field label="Витрати на оплату праці за добу, грн"><Input type="number" step="0.01" value={finance.dailyPayrollCosts} onChange={(e) => setFinance({ ...finance, dailyPayrollCosts: e.target.value })} /></Field>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={saveFinance}>Зберегти</Button>
            {financeSaved && <span className="text-xs text-emerald-400">Збережено</span>}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Розміри за замовчуванням</h3>
        <p className="mb-4 text-xs text-slate-500">
          Загальна сітка магазину: бот бере її для товарів, у яких ні в товарі, ні в категорії немає своєї сітки чи меж.
          Порядок: товар → категорія → ця сітка. Свою сітку задавайте в категорії чи товарі лише там, де вона справді інша.
        </p>
        <SizeFitEditor fitRows={fitRows} onFitRows={setFitRows} rules={sizeRules} onRules={setSizeRules} inheritNote="Порожньо — бот не підбере розмір за зростом і вагою, доки сітку не задано тут, у категорії чи товарі." rulesInheritNote="" />
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={saveSizes}>Зберегти розміри</Button>
          {sizesSaved && <span className="text-xs text-emerald-400">Збережено</span>}
        </div>
      </Card>
    </div>
  );
}
