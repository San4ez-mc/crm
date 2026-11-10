// §9.16 Налаштування — Загальні: назва магазину, API-ключ (показати/перегенерувати),
// + фінансові вхідні для щоденної аналітики (курс, постійні витрати, ЗП)
// + розміри за замовчуванням (2026-10-18): загальна сітка магазину й межі для категорій/товарів без власних.
// + магазин для бота (2026-10-21): тип магазину для ШІ, передоплата, терміни відправки — бот бере їх звідси, а не з коду.
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PageHeader, Card, Field, Input, Textarea, Button, ErrorBanner, formatDateTime } from '../components/common/Common';
import SizeFitEditor, { fitChartToRows } from '../components/common/SizeFitEditor';
import apiDocsTemplate from '../docs/crm-api.md?raw';

// Код для HTML лендінгу (2026-11-05): одна функція sendFinekoOrder(...) — шле замовлення в CRM цього магазину.
const API_ORIGIN = 'https://pcrm.fineko.space';
function landingSnippet(publicKey) {
  return `<script>
// Відправка замовлення в CRM. Приклад виклику з форми:
// sendFinekoOrder({ name: 'Імʼя', phone: '0671234567', city: 'Київ', warehouse: 'Відділення №5',
//   items: [{ name: 'Худі оверсайз', price: 1290, quantity: 1, properties: [{ name: 'Розмір', value: 'L' }] }] })
//   .then(function () { alert('Дякуємо! Ми вам зателефонуємо'); })
//   .catch(function (e) { alert(e.message); });
function sendFinekoOrder(data) {
  var utm = {};
  new URLSearchParams(location.search).forEach(function (v, k) { if (/^utm_|^fbclid$/.test(k)) utm[k] = v; });
  return fetch('${API_ORIGIN}/api/public/landing-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ key: '${publicKey}', source: location.hostname + location.pathname, utm: utm }, data))
  }).then(function (r) { return r.json().catch(function () { return {}; }); })
    .then(function (j) { if (!j.ok) throw new Error((j.error && j.error.message) || 'Не вдалося відправити, спробуйте ще раз'); return j.data; });
}
</script>`;
}

// Довідка «Доступні запити» (2026-11-05, власник: у вільному місці під ключем показати запити й приклади). Кожен запит — з Bearer <API-ключ>,
// відповідь завжди { ok, data } або { ok:false, error:{ code, message } }. Лише те, що реально використовують воронка, Flows і зовнішні скрипти.
const API_DOCS = [
  ['Замовлення', [
    ['GET', '/orders?take=100&skip=0&q=…&stageId=…&ftFrom=2026-11-01&ftTo=2026-11-05', 'Список замовлень (пошук за телефоном, ТТН, нікнеймом; фільтр за стадією й датою оформлення)'],
    ['GET', '/orders/:id', 'Одне замовлення з позиціями, оплатами, рекламою'],
    ['POST', '/orders', 'Створити замовлення: { buyer:{phone,fullName}, items:[{name,price,quantity}], shipping:{city,warehouse}, sourceName?, paymentType? }'],
    ['PATCH', '/orders/:id', 'Змінити частину полів: { stageId, shipping, managerComment, ttn, sourceName, paymentType } — лише передані'],
    ['PUT', '/orders/:id/items', 'Замінити позиції замовлення'],
    ['DELETE', '/orders/:id', 'Видалити замовлення (зникає зі списку й звітів, лишається в базі)'],
    ['POST', '/orders/:id/restore', 'Відновити видалене замовлення'],
    ['GET', '/orders/lookup-client?ig=…&phone=…', 'Останнє замовлення клієнта за нікнеймом чи телефоном (для бота)'],
    ['GET', '/orders/summary', 'Кількість і сума замовлень по статусах'],
    ['GET', '/orders/export.xlsx', 'Excel із замовленнями за тими самими фільтрами'],
  ]],
  ['Покупці, оплати, повернення', [
    ['GET', '/buyers?q=…', 'Список покупців'],
    ['POST', '/buyers/find-or-create', 'Знайти покупця за телефоном або створити'],
    ['PATCH', '/buyers/:id', 'Змінити покупця (імʼя, виміри, збережена доставка)'],
    ['GET', '/payments', 'Оплати'],
    ['POST', '/payments', 'Записати оплату до замовлення'],
    ['GET', '/returns', 'Повернення й обміни'],
    ['POST', '/returns', 'Створити повернення'],
  ]],
  ['Каталог і воронка', [
    ['GET', '/products?q=…&categoryId=…&isSet=…', 'Товари (з кольорами й розмірами); фільтри: q, categoryId, supplierId, sku, isSet, take, skip'],
    ['GET', '/products/:id', 'Один товар'],
    ['POST', '/products', 'Створити товар: { name, sku, price, … }'],
    ['PATCH', '/products/:id', 'Змінити товар (лише передані поля)'],
    ['GET', '/categories', 'Усі категорії з кількістю товарів'],
    ['GET', '/categories/:id', 'Одна категорія'],
    ['POST', '/categories', 'Створити категорію: { name, … }'],
    ['GET', '/public/products?key=pk_…', 'Відкритий ключ: товари для вітрини (безпечні поля; фільтри q, categoryId, sku, isSet, take, skip)'],
    ['GET', '/public/categories?key=pk_…', 'Відкритий ключ: категорії з товарами в наявності'],
    ['GET', '/pipelines', 'Воронки продажів зі стадіями'],
    ['POST', '/funnel-events', 'Подія воронки бота (картка розмови на дошці)'],
    ['GET', '/funnel-events/summary', 'Конверсія по етапах воронки'],
    ['GET', '/knowledge/search?q=…', 'Пошук у базі знань'],
  ]],
];

function apiExamples(origin, key) {
  return `# Список останніх замовлень
curl -H "Authorization: Bearer ${key}" \\
  "${origin}/api/orders?take=20"

# Створити замовлення (JSON краще класти у файл: curl -d @order.json)
curl -X POST "${origin}/api/orders" \\
  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\
  -d '{"buyer":{"phone":"0671234567","fullName":"Іван"},"items":[{"name":"Худі","price":1290,"quantity":1}],"sourceName":"Скрипт"}'

// Те саме з JavaScript (лише на сервері — ключ повний, у браузер сторінки його класти не можна)
const res = await fetch('${origin}/api/orders?take=20', { headers: { Authorization: 'Bearer ${key}' } });
const { ok, data, error } = await res.json();

// PHP: замовлення з форми лендінгу (виконується на сервері сайту, ключ у браузер не потрапляє)
<?php
$order = [
  'buyer' => ['phone' => $_POST['phone'], 'fullName' => $_POST['name']],
  'items' => [['name' => 'Худі оверсайз', 'price' => 1290, 'quantity' => 1]],
  'shipping' => ['city' => $_POST['city'] ?? '', 'warehouse' => $_POST['warehouse'] ?? ''],
  'sourceName' => 'Лендінг: ' . $_SERVER['HTTP_HOST'],
  'placedBy' => 'Лендінг',
  'stageName' => 'Замовлення прийняте',
  'paymentType' => 'cod',
  'managerComment' => $_POST['comment'] ?? '',
];
$ch = curl_init('${origin}/api/orders');
curl_setopt_array($ch, [
  CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15,
  CURLOPT_HTTPHEADER => ['Authorization: Bearer ${key}', 'Content-Type: application/json'],
  CURLOPT_POSTFIELDS => json_encode($order, JSON_UNESCAPED_UNICODE),
]);
$res = json_decode(curl_exec($ch), true);
if (empty($res['ok'])) { /* помилка: $res['error']['message'] */ }`;
}

export default function SettingsGeneralPage() {
  const [tenant, setTenant] = useState(null);
  const [name, setName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [finance, setFinance] = useState({ usdExchangeRate: '', dailyFixedCosts: '', dailyPayrollCosts: '', forecastRefusalPct: '', forecastReturnPct: '', managerCostPercentDefault: '' });
  const [financeSaved, setFinanceSaved] = useState(false);
  const [refreshingRate, setRefreshingRate] = useState(false);
  const [fitRows, setFitRows] = useState([]);
  const [sizeRules, setSizeRules] = useState([]);
  const [sizesSaved, setSizesSaved] = useState(false);
  const [shop, setShop] = useState({ shopDescription: '', prepaymentAmount: '', shippingTerms: '' });
  const [shopSaved, setShopSaved] = useState(false);

  async function load() {
    try {
      const { data } = await api.getTenantSettings();
      setTenant(data); setName(data.name);
      setFinance({
        usdExchangeRate: data.usdExchangeRate ?? '',
        dailyFixedCosts: data.dailyFixedCosts ?? '',
        dailyPayrollCosts: data.dailyPayrollCosts ?? '',
        forecastRefusalPct: data.forecastRefusalPct ?? '',
        forecastReturnPct: data.forecastReturnPct ?? '',
        managerCostPercentDefault: data.managerCostPercentDefault ?? '',
      });
      setFitRows(fitChartToRows(data.fitChart)); setSizeRules(Array.isArray(data.sizeRules) ? data.sizeRules : []);
      setShop({ shopDescription: data.shopDescription || '', prepaymentAmount: data.prepaymentAmount ?? '', shippingTerms: data.shippingTerms || '' });
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
        forecastRefusalPct: finance.forecastRefusalPct === '' ? null : Number(finance.forecastRefusalPct),
        forecastReturnPct: finance.forecastReturnPct === '' ? null : Number(finance.forecastReturnPct),
        managerCostPercentDefault: finance.managerCostPercentDefault === '' ? null : Number(finance.managerCostPercentDefault),
      });
      setFinanceSaved(true);
    } catch (e) { setError(e.message); }
  }

  async function saveSizes() {
    setError(''); setSizesSaved(false);
    try { await api.updateTenantSettings({ fitChart: fitRows.length ? fitRows : null, sizeRules }); setSizesSaved(true); load(); }
    catch (e) { setError(e.message); }
  }

  async function saveShop() {
    setError(''); setShopSaved(false);
    try {
      await api.updateTenantSettings({ shopDescription: shop.shopDescription, prepaymentAmount: shop.prepaymentAmount === '' ? null : Number(shop.prepaymentAmount), shippingTerms: shop.shippingTerms });
      setShopSaved(true); load();
    } catch (e) { setError(e.message); }
  }

  async function regenerate() {
    if (!confirm('Перегенерувати API-ключ? Стару воронку/MCP-конектор доведеться оновити новим ключем.')) return;
    try { const { data } = await api.regenerateApiKey(); setTenant({ ...tenant, apiKey: data.apiKey }); } catch (e) { setError(e.message); }
  }

  // Файл документації для розробників і ШІ-агентів (apps/admin/src/docs/crm-api.md). Ключів у файл НЕ підставляємо — його передають іншим людям і ШІ.
  function downloadDocs() {
    const text = apiDocsTemplate
      .split('{{ORIGIN}}').join(API_ORIGIN)
      .split('{{SHOP}}').join(tenant?.name || '')
      .split('{{DATE}}').join(new Date().toLocaleDateString('uk-UA'));
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `fineko-crm-api-${String(tenant?.name || 'shop').replace(/[^\w.-]+/g, '_')}.md`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function regeneratePublic() {
    if (tenant.publicKey && !confirm('Перегенерувати відкритий ключ? Лендінги зі старим ключем перестануть створювати замовлення, поки не вставите новий код.')) return;
    try { const { data } = await api.regeneratePublicKey(); setTenant({ ...tenant, publicKey: data.publicKey }); } catch (e) { setError(e.message); }
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
            <p className="mt-3 text-xs text-slate-500">
              Цей ключ <b>повний</b>: ним працюють воронка, Flows і MCP — він читає й змінює все в магазині. Тримайте його лише на серверах,
              у код сторінок (лендінги) не вставляйте — для лендінгу є відкритий ключ нижче.
            </p>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-5">
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Доступні запити (API)</h3>
              <Button variant="secondary" onClick={downloadDocs}>⬇ Завантажити документацію</Button>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Адреса: <code className="text-slate-300">{API_ORIGIN}/api</code>. Кожен запит із заголовком <code className="text-slate-300">Authorization: Bearer &lt;API-ключ&gt;</code>.
              Відповідь — <code className="text-slate-300">{'{ ok, data }'}</code> або <code className="text-slate-300">{'{ ok:false, error }'}</code>.
            </p>
            <div className="space-y-2">
              {API_DOCS.map(([group, rows]) => (
                <details key={group} className="rounded-lg border border-slate-800 px-3 py-2">
                  <summary className="cursor-pointer text-sm text-slate-200">{group} <span className="text-xs text-slate-500">· {rows.length}</span></summary>
                  <div className="mt-2 space-y-1.5">
                    {rows.map(([method, path, note]) => (
                      <div key={method + path} className="text-xs">
                        <span className={`mr-2 inline-block w-12 rounded px-1 py-0.5 text-center font-mono text-[10px] ${method === 'GET' ? 'bg-sky-500/15 text-sky-300' : method === 'POST' ? 'bg-emerald-500/15 text-emerald-300' : method === 'DELETE' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{method}</span>
                        <code className="break-all text-slate-300">{path}</code>
                        <div className="ml-14 text-slate-500">{note}</div>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            <Field label="Приклади (curl, JavaScript, PHP)">
              <textarea readOnly rows={22} value={apiExamples(API_ORIGIN, showKey ? tenant.apiKey : '<API-ключ>')} onFocus={(e) => e.target.select()} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-300" />
            </Field>
            <p className="text-xs text-slate-500">Ключ у прикладах підставляється, коли натиснути «Показати» над цим блоком. У файл документації ключі не потрапляють — там стоїть <code>&lt;API_KEY&gt;</code>; файл безпечно передавати розробнику чи ШІ-агенту, ключ дайте окремо.</p>
          </div>

          <div className="mt-6 border-t border-slate-800 pt-5">
            <h3 className="mb-1 text-sm font-semibold">Відкритий ключ для сайту: замовлення і каталог</h3>
            <p className="mb-3 text-xs text-slate-500">
              Відкритий ключ можна вставляти в HTML сайту чи лендінгу. Він уміє дві речі: створити замовлення в цьому магазині («Джерело» пишеться
              «Лендінг: адреса сторінки») і віддати каталог для вітрини (товари з кольорами й розмірами та категорії, без ціни постачальника й внутрішніх
              нотаток). Запити: GET /api/public/products, /api/public/products/:артикул, /api/public/categories. Повний API-ключ вище в сайт вставляти не можна.
            </p>
            {tenant.publicKey ? (
              <>
                <Field label="Відкритий ключ для лендінгу"><Input readOnly value={tenant.publicKey} onFocus={(e) => e.target.select()} /></Field>
                <Field label="Код для сторінки (вставити перед </body>)">
                  <textarea readOnly rows={9} value={landingSnippet(tenant.publicKey)} onFocus={(e) => e.target.select()} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-300" />
                </Field>
                <Button variant="danger" onClick={regeneratePublic}>Перегенерувати відкритий ключ</Button>
              </>
            ) : (
              <Button variant="secondary" onClick={regeneratePublic}>Створити відкритий ключ</Button>
            )}
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
          <Field label="Витрати на оплату праці за добу, грн (фіксована ставка; якщо менеджерам платять лише % від націнки, лишіть порожнім, щоб ЗП не рахувалась двічі)"><Input type="number" step="0.01" value={finance.dailyPayrollCosts} onChange={(e) => setFinance({ ...finance, dailyPayrollCosts: e.target.value })} /></Field>
          <Field label="Прогноз відмов на пошті, % (за замовчуванням для всіх днів; порожньо = 20)"><Input type="number" step="0.1" min="0" max="99" value={finance.forecastRefusalPct} onChange={(e) => setFinance({ ...finance, forecastRefusalPct: e.target.value })} /></Field>
          <Field label="Прогноз повернень, % (порожньо = 3)"><Input type="number" step="0.1" min="0" max="99" value={finance.forecastReturnPct} onChange={(e) => setFinance({ ...finance, forecastReturnPct: e.target.value })} /></Field>
          <Field label="ЗП менеджера, % від націнки (для товарів, де в «Витрати по товару» не вказано свого %)"><Input type="number" step="0.1" min="0" max="99" value={finance.managerCostPercentDefault} onChange={(e) => setFinance({ ...finance, managerCostPercentDefault: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">Для кожного дня окремо значення можна вписати в «Щоденній аналітиці». Власний % товару в «Витрати по товару» має пріоритет над загальним.</p>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={saveFinance}>Зберегти</Button>
            {financeSaved && <span className="text-xs text-emerald-400">Збережено</span>}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="mb-1 text-sm font-semibold">Магазин для бота</h3>
        <p className="mb-4 text-xs text-slate-500">
          Бот бере ці умови звідси й називає їх клієнтам. Порожнє поле — бот не називає цю умову (не вигадує).
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Field label="Хто ми (для ШІ)"><Input placeholder="Instagram-магазин чоловічого одягу" value={shop.shopDescription} onChange={(e) => setShop({ ...shop, shopDescription: e.target.value })} /></Field>
          <Field label="Передоплата за часткової оплати, грн"><Input type="number" step="1" placeholder="200" value={shop.prepaymentAmount} onChange={(e) => setShop({ ...shop, prepaymentAmount: e.target.value })} /></Field>
        </div>
        <Field label="Терміни відправки (як бот скаже клієнту)"><Textarea rows={2} placeholder="Відправка — до 5 робочих днів з моменту оформлення (субота й неділя — вихідні)" value={shop.shippingTerms} onChange={(e) => setShop({ ...shop, shippingTerms: e.target.value })} /></Field>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={saveShop}>Зберегти</Button>
          {shopSaved && <span className="text-xs text-emerald-400">Збережено</span>}
        </div>
      </Card>

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
