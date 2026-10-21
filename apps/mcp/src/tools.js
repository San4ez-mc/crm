// Fineko CRM MCP tools — той самий патерн, що platform/apps/mcp/src/tools-flows.js:
// один файл TOOLS[] (JSON Schema) + callTool(name,args) диспетчер.
// Призначення (§5 ТЗ): НАЛАШТУВАННЯ — товари, категорії, постачальники, стадії pipeline,
// рекламні акаунти. Рантайм-операції воронки (lookup/create_order) йдуть через REST API
// з Bearer tenant.apiKey — MCP працює крос-тенантно з explicit tenantId в кожному тулі.
const { db } = require('@crm/db');
const { NotFoundError, ValidationError, ConflictError } = require('@crm/errors');
const { normalizeFitChart, normalizeSizeRules } = require('../../api/src/lib/sizeFit'); // розміри як дані (2026-10-18) — той самий формат, що в API

function safeJsonStringify(value) {
  return JSON.stringify(value, (key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

// Той самий розрахунок, що apps/api/src/routes/products.js serializeProduct() — тримати
// в синку (2026-09-09: Product.sizes + Offer.availableSizes вирішують доступність по
// розміру в межах кольору; alwaysAvailable — загальний вимикач, ігнорує все нижче).
function offerEffectiveSizes(product, offer) {
  return offer.sizesCustomized ? (Array.isArray(offer.availableSizes) ? offer.availableSizes : []) : (product.sizes || []);
}
function withOfferAvailability(product) {
  const offers = Array.isArray(product.offers)
    ? product.offers.map((o) => {
        const effectiveSizes = offerEffectiveSizes(product, o);
        const inStock = !product.outOfStock && (product.alwaysAvailable !== false || !Array.isArray(product.sizes) || product.sizes.length === 0 || effectiveSizes.length > 0);
        return { ...o, effectiveSizes, inStock };
      })
    : product.offers;
  return { ...product, offers, displayName: product.customerName || product.name };
}

// Замовлення для MCP (2026-10-18) — той самий набір полів, що бачить менеджер у картці.
const MCP_ORDER_INCLUDE = {
  buyer: true,
  stage: { select: { id: true, name: true, pipelineId: true } },
  items: { include: { supplier: { select: { id: true, name: true } }, product: { select: { id: true, sku: true, name: true, supplierId: true } } } },
  payments: { select: { id: true, amount: true, method: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
};
function orderView(o) {
  if (!o) return o;
  const total = (o.items || []).reduce((s, it) => s + Number(it.price) * it.quantity, 0);
  const prepay = o.prepaymentAmount != null ? Number(o.prepaymentAmount) : null;
  return { ...o, total, codAmount: prepay != null ? Math.max(0, total - prepay) : null };
}
async function mcpOrderItems(tenantId, items) {
  const ids = [...new Set(items.filter((it) => it && it.productId && (it.name === undefined || it.price === undefined)).map((it) => String(it.productId)))];
  const byId = ids.length ? new Map((await db.product.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, name: true, price: true } })).map((p) => [p.id, p])) : new Map();
  return items.map((it, i) => {
    const p = it && it.productId ? byId.get(String(it.productId)) : null;
    const name = String((it && it.name) || (p && p.name) || '').trim();
    const price = Number(it && it.price !== undefined ? it.price : p && p.price);
    const quantity = parseInt(it && it.quantity, 10) || 1;
    if (!name) throw new ValidationError(`Позиція ${i + 1}: немає назви (вкажіть name або productId)`);
    if (!Number.isFinite(price) || price < 0) throw new ValidationError(`Позиція ${i + 1}: неправильна ціна`);
    return { ...it, name: name.slice(0, 500), price, quantity: Math.max(1, quantity) };
  });
}
async function mcpTenantStage(tenantId, stageId) {
  if (!stageId) return null;
  const st = await db.stage.findFirst({ where: { id: String(stageId), pipeline: { tenantId } } });
  if (!st) throw new ValidationError('Стадію не знайдено в цьому магазині', { stageId });
  return st.id;
}

const TOOLS = [
  // ── Tenants ──────────────────────────────────────────────────────────
  { name: 'list_tenants', description: 'Список усіх магазинів (tenants) СРМ.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_tenant', description: 'Деталі одного tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'update_tenant_sizes', description: 'Загальна сітка підбору розміру магазину (зріст/вага) і межі від експерта — для категорій і товарів без власних (бот: товар → категорія → магазин).', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, fitChart: { type: 'object', description: '{"S":{"height":[160,175],"weight":[55,65]},…}; null — очистити' }, sizeRules: { type: 'array', items: { type: 'object', properties: { size: { type: 'string' }, wMin: { type: 'number' }, wMax: { type: 'number' }, hMin: { type: 'number' }, hMax: { type: 'number' }, note: { type: 'string' } } }, description: 'Межі: перше правило, що збіглося, перекриває сітку' } }, required: ['tenantId'] } },
  { name: 'update_tenant_shop_profile', description: 'Умови й тип магазину для бота (те саме, що «Налаштування → Загальні → Магазин для бота»): shopDescription — хто ми для ШІ («Instagram-магазин чоловічого одягу»); prepaymentAmount — передоплата за часткової оплати, грн; shippingTerms — терміни відправки словами.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, shopDescription: { type: 'string' }, prepaymentAmount: { type: 'number' }, shippingTerms: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'new_tenant', description: 'Створити новий магазин (tenant).', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },

  // ── Category §4.5 ────────────────────────────────────────────────────
  { name: 'list_categories', description: 'Категорії товарів tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_category', description: 'Створити категорію.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, fitChart: { type: 'object', description: 'Сітка підбору за зростом/вагою: {"S":{"height":[160,175],"weight":[55,65]},…}; null — успадковувати' }, sizeRules: { type: 'array', items: { type: 'object', properties: { size: { type: 'string' }, wMin: { type: 'number' }, wMax: { type: 'number' }, hMin: { type: 'number' }, hMax: { type: 'number' }, note: { type: 'string' } } }, description: 'Межі розмірів від експерта: перше правило, що збіглося, перекриває сітку' }, sizeChartImage: { type: 'string' }, sizeChartData: { type: 'object' }, name: { type: 'string' }, description: { type: 'string' }, aiInstructions: { type: 'string', description: 'Що бот має дізнатись у клієнта для товарів цієї категорії (вільний текст)' }, requiredParams: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, unit: { type: 'string' }, hint: { type: 'string' } } }, description: 'Структурований список параметрів для збору перед оформленням (напр. [{name:"зріст",unit:"см"},{name:"вага",unit:"кг"}] для одягу, [{name:"розмір стопи",unit:"см"}] для взуття)' }, synonyms: { type: 'array', items: { type: 'string' }, description: 'Додаткові слова/синоніми, якими клієнт може назвати цю категорію в тексті (не прості відміни name, воронка стемить name сама) — напр. для категорії "Взуття": ["лофери","кросівки","туфлі","черевики","кеди"]; для "Куртки": ["вітровка"]. Воронка звіряє ці слова з повідомленням клієнта, щоб розпізнати намір і не показати не той товар.' } }, required: ['tenantId', 'name'] } },
  { name: 'update_category', description: 'Оновити категорію (зокрема сітку підбору розмірів і межі для товарів категорії без власних).', inputSchema: { type: 'object', properties: { categoryId: { type: 'string' }, fitChart: { type: 'object', description: 'Сітка підбору за зростом/вагою: {"S":{"height":[160,175],"weight":[55,65]},…}; null — успадковувати' }, sizeRules: { type: 'array', items: { type: 'object', properties: { size: { type: 'string' }, wMin: { type: 'number' }, wMax: { type: 'number' }, hMin: { type: 'number' }, hMax: { type: 'number' }, note: { type: 'string' } } }, description: 'Межі розмірів від експерта: перше правило, що збіглося, перекриває сітку' }, sizeChartImage: { type: 'string' }, sizeChartData: { type: 'object' }, name: { type: 'string' }, description: { type: 'string' }, aiInstructions: { type: 'string' }, requiredParams: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, unit: { type: 'string' }, hint: { type: 'string' } } } }, synonyms: { type: 'array', items: { type: 'string' } } }, required: ['categoryId'] } },
  { name: 'delete_category', description: 'Видалити категорію (лише якщо немає товарів).', inputSchema: { type: 'object', properties: { categoryId: { type: 'string' } }, required: ['categoryId'] } },

  // ── Supplier §4.4 ────────────────────────────────────────────────────
  { name: 'list_suppliers', description: 'Постачальники tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_supplier', description: 'Створити постачальника.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, mechanism: { type: 'string', description: 'ручне / EasyDrop / BrewDrop / інше' }, contactInfo: { type: 'string' }, description: { type: 'string' }, aiNotes: { type: 'string' }, website: { type: 'string' }, telegramGroupId: { type: 'string' }, loginUsername: { type: 'string' }, loginPassword: { type: 'string' } }, required: ['tenantId', 'name'] } },
  { name: 'update_supplier', description: 'Оновити постачальника.', inputSchema: { type: 'object', properties: { supplierId: { type: 'string' }, name: { type: 'string' }, mechanism: { type: 'string' }, contactInfo: { type: 'string' }, description: { type: 'string' }, aiNotes: { type: 'string' }, website: { type: 'string' }, telegramGroupId: { type: 'string' }, loginUsername: { type: 'string' }, loginPassword: { type: 'string' } }, required: ['supplierId'] } },
  { name: 'delete_supplier', description: 'Видалити постачальника (лише якщо немає товарів).', inputSchema: { type: 'object', properties: { supplierId: { type: 'string' } }, required: ['supplierId'] } },

  // ── Fop (ФОП для прийому оплат) — окремо per-tenant ─────────────────
  { name: 'list_fops', description: 'ФОПи tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_fop', description: 'Створити ФОП.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, iban: { type: 'string' }, cardNumber: { type: 'string', description: 'Номер картки для card-to-card оплати (окрім IBAN)' }, cardComment: { type: 'string', description: 'Підпис до картки в повідомленні бота (отримувач, банк) — замість назви ФОП, якщо заповнено' }, taxId: { type: 'string', description: 'ІПН' }, monobankToken: { type: 'string' } }, required: ['tenantId', 'name'] } },
  { name: 'update_fop', description: 'Оновити ФОП. isActive:true робить його єдиним активним для tenant (деактивує інші).', inputSchema: { type: 'object', properties: { fopId: { type: 'string' }, name: { type: 'string' }, iban: { type: 'string' }, cardNumber: { type: 'string' }, cardComment: { type: 'string' }, taxId: { type: 'string' }, monobankToken: { type: 'string' }, isActive: { type: 'boolean' } }, required: ['fopId'] } },
  { name: 'delete_fop', description: 'Видалити ФОП.', inputSchema: { type: 'object', properties: { fopId: { type: 'string' } }, required: ['fopId'] } },

  // ── Product / Offer §4.2/§4.3 ───────────────────────────────────────
  { name: 'list_products', description: 'Каталог товарів з варіантами (offers) і фото.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, q: { type: 'string' }, categoryId: { type: 'string' }, supplierId: { type: 'string' }, isSet: { type: 'boolean', description: 'фільтр: тільки комплекти (true) чи тільки звичайні товари (false)' } }, required: ['tenantId'] } },
  { name: 'get_product', description: 'Товар за id або sku.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, productId: { type: 'string' }, sku: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_product', description: 'Створити товар.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string', description: 'Внутрішня назва (від постачальника/для CRM)' }, customerName: { type: 'string', description: 'Назва, яку бачить клієнт у боті; якщо порожньо — бот показує name' }, sku: { type: 'string' }, price: { type: 'number' }, minPrice: { type: 'number' }, categoryId: { type: 'string' }, presentationText: { type: 'string', description: 'Готовий текст-презентація, бот показує verbatim' }, adMatchTokens: { type: 'array', items: { type: 'string' } }, companionProductIds: { type: 'array', items: { type: 'string' } }, supplierId: { type: 'string' }, supplierArticle: { type: 'string' }, thumbnailUrl: { type: 'string' }, images: { type: 'array', items: { type: 'string' } }, aiNotes: { type: 'string', description: 'Нотатки для бота (не показуються клієнту)' }, sizeChartData: { type: 'object', description: '{title,unit,sizes[],measurements}' }, bulkPricing: { type: 'array', items: { type: 'object', properties: { quantity: { type: 'number' }, price: { type: 'number' } } }, description: 'Ціна за кількість — однакова для всіх варіантів кольору' }, isSet: { type: 'boolean', description: 'true = це комплект (окремий пункт меню, не категорія)' }, outOfStock: { type: 'boolean', description: 'true = товару немає в наявності зовсім: бот не пропонує його, з комплектів прибирає' }, alwaysAvailable: { type: 'boolean', description: 'true (дефолт) = розміри/наявність по кольорах ігноруються, товар завжди доступний; false = дивимось на sizes/offer.availableSizes' }, sizes: { type: 'array', items: { type: 'string' }, description: 'Майстер-список розмірів товару, напр. ["S","M","L","XL"] — спільний для всіх кольорів, якщо колір (offer) не звужує його своїм availableSizes' } }, required: ['tenantId', 'name', 'sku', 'price'] } },
  { name: 'update_product', description: 'Оновити товар (часткове).', inputSchema: { type: 'object', properties: { productId: { type: 'string' }, fitChart: { type: 'object', description: 'Сітка підбору за зростом/вагою: {"S":{"height":[160,175],"weight":[55,65]},…}; null — успадковувати' }, sizeRules: { type: 'array', items: { type: 'object', properties: { size: { type: 'string' }, wMin: { type: 'number' }, wMax: { type: 'number' }, hMin: { type: 'number' }, hMax: { type: 'number' }, note: { type: 'string' } } }, description: 'Межі розмірів від експерта: перше правило, що збіглося, перекриває сітку' }, name: { type: 'string' }, customerName: { type: 'string' }, sku: { type: 'string' }, price: { type: 'number' }, minPrice: { type: 'number' }, categoryId: { type: 'string' }, presentationText: { type: 'string' }, adMatchTokens: { type: 'array', items: { type: 'string' } }, companionProductIds: { type: 'array', items: { type: 'string' } }, supplierId: { type: 'string' }, supplierArticle: { type: 'string' }, thumbnailUrl: { type: 'string' }, images: { type: 'array', items: { type: 'string' } }, aiNotes: { type: 'string' }, sizeChartData: { type: 'object' }, bulkPricing: { type: 'array', items: { type: 'object', properties: { quantity: { type: 'number' }, price: { type: 'number' } } } }, isSet: { type: 'boolean' }, outOfStock: { type: 'boolean' }, alwaysAvailable: { type: 'boolean' }, sizes: { type: 'array', items: { type: 'string' } } }, required: ['productId'] } },
  { name: 'delete_product', description: 'Видалити товар (лише якщо не задіяний у замовленнях).', inputSchema: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] } },
  { name: 'update_set_components', description: 'Задати склад набору {componentProductId,qty,fixedColor?}[] — повна заміна.', inputSchema: { type: 'object', properties: { productId: { type: 'string' }, components: { type: 'array', items: { type: 'object', properties: { componentProductId: { type: 'string' }, qty: { type: 'number' }, fixedColor: { type: 'string', description: 'Колір цієї позиції, зафіксований САМЕ в межах цього набору (напр. джинси завжди сині в цьому комплекті) — воронка більше не питає клієнта і не вгадує; порожньо/не задано = як раніше' } } } } }, required: ['productId', 'components'] } },
  { name: 'create_offer', description: 'Додати варіант товару (колір). Ціна лишається спільною на товарі. availableSizes — які з Product.sizes доступні саме в цьому кольорі (порожньо = всі).', inputSchema: { type: 'object', properties: { productId: { type: 'string' }, sku: { type: 'string' }, properties: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } }, description: 'Зазвичай лише [{name:"колір", value:"чорний"}] — розмір тепер у availableSizes' }, availableSizes: { type: 'array', items: { type: 'string' }, description: 'Підмножина Product.sizes, доступна в цьому кольорі; порожньо = успадковує всі' }, images: { type: 'array', items: { type: 'string' }, description: 'до 10 URL, перший = головне фото' } }, required: ['productId'] } },
  { name: 'update_offer', description: 'Оновити варіант товару.', inputSchema: { type: 'object', properties: { offerId: { type: 'string' }, sku: { type: 'string' }, properties: { type: 'array' }, availableSizes: { type: 'array', items: { type: 'string' } }, images: { type: 'array', items: { type: 'string' } } }, required: ['offerId'] } },
  { name: 'delete_offer', description: 'Видалити варіант товару.', inputSchema: { type: 'object', properties: { offerId: { type: 'string' } }, required: ['offerId'] } },

  // ── Pipeline / Stage §4.7 ────────────────────────────────────────────
  { name: 'list_pipelines', description: 'Воронки (pipeline) зі стадіями tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_pipeline', description: 'Створити воронку зі стадіями.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, stageNames: { type: 'array', items: { type: 'string' } } }, required: ['tenantId', 'name'] } },
  { name: 'create_stage', description: 'Додати стадію в кінець воронки.', inputSchema: { type: 'object', properties: { pipelineId: { type: 'string' }, name: { type: 'string' } }, required: ['pipelineId', 'name'] } },
  { name: 'update_stage', description: 'Перейменувати/переставити стадію.', inputSchema: { type: 'object', properties: { stageId: { type: 'string' }, name: { type: 'string' }, order: { type: 'number' } }, required: ['stageId'] } },
  { name: 'delete_stage', description: 'Видалити стадію (лише якщо немає замовлень на ній).', inputSchema: { type: 'object', properties: { stageId: { type: 'string' } }, required: ['stageId'] } },

  // ── Order §4.8 — ручна робота із замовленням (2026-10-18) ───────────
  // Рантайм воронки (оформлення ботом) лишається на REST; тут — те, що робить менеджер у картці замовлення.
  { name: 'list_orders', description: 'Замовлення tenant (найновіші). q — посилання на Instagram або @нік (шукає за нікнеймом), телефон, імʼя або ТТН.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, q: { type: 'string' }, stageId: { type: 'string' }, take: { type: 'number', description: 'до 100, за замовчуванням 30' } }, required: ['tenantId'] } },
  { name: 'get_order', description: 'Замовлення з позиціями (постачальник кожної), покупцем, стадією, способом оплати й журналом платежів.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, orderId: { type: 'string' } }, required: ['tenantId', 'orderId'] } },
  { name: 'create_order', description: 'Створити замовлення вручну (як «Нове замовлення» в CRM). Instagram нормалізується до нікнейма. Постачальник позиції за замовчуванням — з товару.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, buyer: { type: 'object', properties: { phone: { type: 'string' }, fullName: { type: 'string' }, igUsername: { type: 'string', description: 'нікнейм, @нік або посилання на профіль' } } }, items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, name: { type: 'string', description: 'якщо не задано — назва товару' }, price: { type: 'number', description: 'якщо не задано — ціна товару' }, quantity: { type: 'number' }, properties: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } }, description: '[{name:"Колір",value:"чорний"},{name:"Розмір",value:"M"}]' }, supplierId: { type: 'string', description: 'постачальник цієї позиції; не задано — з товару' } } } }, stageId: { type: 'string' }, shipping: { type: 'object', description: '{city, branch|warehouse, recipientFullName, recipientPhone}' }, managerComment: { type: 'string' }, paymentType: { type: 'string', description: 'partial — часткова передплата, full — повна передплата, cod — накладений платіж без передплати' }, prepaymentAmount: { type: 'number', description: 'для partial (за замовчуванням 200 грн); full = сума замовлення, cod = 0' }, ttn: { type: 'array', items: { type: 'string' } } }, required: ['tenantId', 'items'] } },
  { name: 'update_order', description: 'Оновити замовлення: стадія, коментар, доставка, ТТН (замінює список; нова ТТН переводить у «Відправлено», якщо стадію не задано), спосіб оплати/передплата, дані покупця, позиції (повна заміна, з постачальником), cancel:true — скасувати (стадія «Скасовано», лишається в історії).', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, orderId: { type: 'string' }, stageId: { type: 'string' }, managerComment: { type: 'string' }, shipping: { type: 'object' }, ttn: { type: 'array', items: { type: 'string' } }, paymentType: { type: 'string', description: 'partial | full | cod' }, prepaymentAmount: { type: 'number' }, buyer: { type: 'object', properties: { phone: { type: 'string' }, fullName: { type: 'string' }, igUsername: { type: 'string' } } }, items: { type: 'array', items: { type: 'object', properties: { productId: { type: 'string' }, offerId: { type: 'string' }, name: { type: 'string' }, price: { type: 'number' }, quantity: { type: 'number' }, properties: { type: 'array' }, components: { type: 'array' }, isUpsell: { type: 'boolean' }, supplierId: { type: 'string' } } } }, cancel: { type: 'boolean' } }, required: ['tenantId', 'orderId'] } },
  { name: 'update_ttn_statuses', description: 'Спитати Нову пошту про ТТН оформлених замовлень (ключ НП — у налаштуваннях магазину): записує статус, очікувану дату доставки й переводить стадію вперед (Відправлено → Не забрав на пошті → Клієнт забрав). Без orderIds — усі замовлення з ТТН за 60 днів не в кінцевих стадіях.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, orderIds: { type: 'array', items: { type: 'string' } }, moveStages: { type: 'boolean', description: 'false — лише статус, стадію не чіпати' } }, required: ['tenantId'] } },
  { name: 'delete_order', description: 'Видалити помилково створене замовлення — лише без платежів, ТТН і повернень (інакше помилка: таке замовлення скасовують через update_order cancel:true).', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, orderId: { type: 'string' } }, required: ['tenantId', 'orderId'] } },

  // ── Ad §4.9 — підключення рекламних кабінетів/оголошень ─────────────
  { name: 'list_ads', description: 'Оголошення tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'update_ad_variants', description: 'Звʼязати варіанти Advantage+ («…_Group_1» з рефералу розмов, кабінет instagram_messages) зі справжніми оголошеннями: товар і дотики замовлень переходять на оголошення (variantOfAdId). relinkExternalIds — перевірити вже привʼязані варіанти: якщо їхнє оголошення не крутиться (немає витрат), а однойменне живе є — перепривʼязати. dryRun — лише показати.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, dryRun: { type: 'boolean' }, relinkExternalIds: { type: 'array', items: { type: 'string' } } }, required: ['tenantId'] } },
  { name: 'create_ad', description: 'Зареєструвати оголошення (з рекламного кабінету). postId — пост, який рекламується (Meta effective_object_story_id), для групування просувань.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, externalId: { type: 'string' }, name: { type: 'string' }, productId: { type: 'string' }, postId: { type: 'string' }, postUrl: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'update_ad', description: 'Прив\'язати оголошення до товару / перейменувати.', inputSchema: { type: 'object', properties: { adId: { type: 'string' }, productId: { type: 'string' }, name: { type: 'string' } }, required: ['adId'] } },

  // ── CrmCheck — «Перевірити в CRM» (вкладка бази знань, 2026-10-14) ───
  { name: 'list_crm_checks', description: 'Тікети «Перевірити в CRM»: що менеджеру звірити/виправити в даних CRM (залишки, склад, назви, синоніми), з відповіддю менеджера. Порядок: відкриті → з відповіддю → закриті.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, status: { type: 'string', description: 'open | answered | closed, кілька через кому; порожньо = усі' } }, required: ['tenantId'] } },
  { name: 'create_crm_check', description: 'Створити тікет «Перевірити в CRM» для менеджера магазину.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, title: { type: 'string', description: 'Коротко, що не так' }, page: { type: 'string', description: 'Розділ CRM людською мовою: «Товари», «Категорії», «База знань»' }, pageUrl: { type: 'string', description: 'Відносний шлях адмінки: /products?search=A0188, /sets?search=set1116, /categories, /knowledge?tab=shop' }, details: { type: 'string', description: 'Що саме перевірити/виправити і чому' }, sessionLinks: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } } }, description: 'Докази — розмови у Flows: [{label:"@nick — що сталось", url:"https://flows.fineko.space/sessions/<id>"}]' }, priority: { type: 'string', description: 'high | normal' }, createdBy: { type: 'string', description: 'bot | claude | email' }, source: { type: 'string', description: 'Звідки: «аудит Flows 14.10», id правки з Edits' }, attachments: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, name: { type: 'string' } } }, description: 'Скріни: [{url,name}], url — /uploads/<tenantId>/… або http(s)' } }, required: ['tenantId', 'title'] } },
  { name: 'update_crm_check', description: 'Оновити тікет: answer (→ status answered), status closed (закрити) / open (відкрити знову), або поля тікета.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, checkId: { type: 'string' }, title: { type: 'string' }, page: { type: 'string' }, pageUrl: { type: 'string' }, details: { type: 'string' }, sessionLinks: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } } } }, priority: { type: 'string' }, status: { type: 'string', description: 'open | answered | closed' }, answer: { type: 'string' }, actor: { type: 'string', description: 'Хто відповів/закрив (за замовчуванням bot)' }, source: { type: 'string' }, addAttachments: { type: 'array', items: { type: 'object', properties: { url: { type: 'string', description: '/uploads/<tenantId>/… (з POST /api/uploads) або http(s)-посилання на зображення' }, name: { type: 'string' } } }, description: 'Додати скріни до тікета (не для закритого)' }, removeAttachmentUrls: { type: 'array', items: { type: 'string' }, description: 'Прибрати скріни за url' } }, required: ['tenantId', 'checkId'] } },
];

const READ_TOOL_NAMES = new Set(TOOLS.filter((t) => /^(list_|get_)/.test(t.name)).map((t) => t.name));
const WRITE_TOOL_NAMES = new Set(TOOLS.filter((t) => /^(new_|create_|update_|delete_)/.test(t.name)).map((t) => t.name));

async function callTool(name, args = {}) {
  switch (name) {
    case 'list_tenants':
      return db.tenant.findMany({ orderBy: { name: 'asc' } });
    case 'get_tenant': {
      const tenant = await db.tenant.findUnique({ where: { id: args.tenantId } });
      if (!tenant) throw new NotFoundError('Tenant', args.tenantId);
      return tenant;
    }
    case 'update_tenant_sizes':
      return db.tenant.update({ where: { id: args.tenantId }, data: { ...(args.fitChart !== undefined ? { fitChart: normalizeFitChart(args.fitChart) } : {}), ...(args.sizeRules !== undefined ? { sizeRules: normalizeSizeRules(args.sizeRules) } : {}) }, select: { id: true, name: true, fitChart: true, sizeRules: true } });
    case 'update_tenant_shop_profile': {
      if (args.prepaymentAmount !== undefined && args.prepaymentAmount !== null && !(Number(args.prepaymentAmount) > 0)) throw new ValidationError('Передоплата має бути більшою за 0');
      return db.tenant.update({ where: { id: args.tenantId }, data: { ...(args.shopDescription !== undefined ? { shopDescription: String(args.shopDescription || '').trim() || null } : {}), ...(args.prepaymentAmount !== undefined ? { prepaymentAmount: args.prepaymentAmount === null ? null : Number(args.prepaymentAmount) } : {}), ...(args.shippingTerms !== undefined ? { shippingTerms: String(args.shippingTerms || '').trim() || null } : {}) }, select: { id: true, name: true, shopDescription: true, prepaymentAmount: true, shippingTerms: true } });
    }
    case 'new_tenant':
      if (!args.name) throw new ValidationError('name обовʼязкове');
      return db.tenant.create({ data: { name: args.name } });

    case 'list_categories':
      return db.category.findMany({ where: { tenantId: args.tenantId }, orderBy: { name: 'asc' } });
    case 'create_category':
      if (!args.name) throw new ValidationError('name обовʼязкове');
      return db.category.create({ data: { tenantId: args.tenantId, name: args.name, fitChart: normalizeFitChart(args.fitChart) || undefined, sizeRules: normalizeSizeRules(args.sizeRules) || [], sizeChartImage: args.sizeChartImage || null, sizeChartData: args.sizeChartData || undefined, description: args.description || null, aiInstructions: args.aiInstructions || null, requiredParams: Array.isArray(args.requiredParams) ? args.requiredParams : [], synonyms: Array.isArray(args.synonyms) ? args.synonyms : [] } });
    case 'update_category':
      return db.category.update({
        where: { id: args.categoryId },
        data: { ...(args.fitChart !== undefined ? { fitChart: normalizeFitChart(args.fitChart) } : {}), ...(args.sizeRules !== undefined ? { sizeRules: normalizeSizeRules(args.sizeRules) } : {}), ...(args.sizeChartImage !== undefined ? { sizeChartImage: args.sizeChartImage || null } : {}), ...(args.sizeChartData !== undefined ? { sizeChartData: args.sizeChartData || require('@prisma/client').Prisma.DbNull } : {}), ...(args.name !== undefined ? { name: args.name } : {}), ...(args.description !== undefined ? { description: args.description } : {}), ...(args.aiInstructions !== undefined ? { aiInstructions: args.aiInstructions } : {}), ...(args.requiredParams !== undefined ? { requiredParams: Array.isArray(args.requiredParams) ? args.requiredParams : [] } : {}), ...(args.synonyms !== undefined ? { synonyms: Array.isArray(args.synonyms) ? args.synonyms : [] } : {}) },
      });
    case 'delete_category': {
      const count = await db.product.count({ where: { categoryId: args.categoryId } });
      if (count > 0) throw new ConflictError('Спершу перенесіть товари з цієї категорії', { productsCount: count });
      await db.category.delete({ where: { id: args.categoryId } });
      return { id: args.categoryId, deleted: true };
    }

    case 'list_suppliers':
      return db.supplier.findMany({ where: { tenantId: args.tenantId }, orderBy: { name: 'asc' } });
    case 'create_supplier':
      if (!args.name) throw new ValidationError('name обовʼязкове');
      return db.supplier.create({ data: { tenantId: args.tenantId, name: args.name, mechanism: args.mechanism || null, contactInfo: args.contactInfo || null, description: args.description || null, aiNotes: args.aiNotes || null, website: args.website || null, telegramGroupId: args.telegramGroupId || null, loginUsername: args.loginUsername || null, loginPassword: args.loginPassword || null } });
    case 'update_supplier': {
      const data = {};
      for (const key of ['name', 'mechanism', 'contactInfo', 'description', 'aiNotes', 'website', 'telegramGroupId', 'loginUsername', 'loginPassword']) if (args[key] !== undefined) data[key] = args[key];
      return db.supplier.update({ where: { id: args.supplierId }, data });
    }
    case 'delete_supplier': {
      const count = await db.product.count({ where: { supplierId: args.supplierId } });
      if (count > 0) throw new ConflictError('Спершу відвʼяжіть товари від цього постачальника', { productsCount: count });
      await db.supplier.delete({ where: { id: args.supplierId } });
      return { id: args.supplierId, deleted: true };
    }

    case 'list_fops':
      return db.fop.findMany({ where: { tenantId: args.tenantId }, orderBy: { name: 'asc' } });
    case 'create_fop':
      if (!args.name) throw new ValidationError('name обовʼязкове');
      return db.fop.create({ data: { tenantId: args.tenantId, name: args.name, iban: args.iban || null, cardNumber: args.cardNumber || null, cardComment: args.cardComment || null, taxId: args.taxId || null, monobankToken: args.monobankToken || null } });
    case 'update_fop': {
      if (args.isActive === true) {
        const fop = await db.fop.findUnique({ where: { id: args.fopId } });
        if (!fop) throw new NotFoundError('Fop', args.fopId);
        await db.$transaction([
          db.fop.updateMany({ where: { tenantId: fop.tenantId }, data: { isActive: false } }),
          db.fop.update({ where: { id: fop.id }, data: { isActive: true } }),
        ]);
      }
      const data = {};
      for (const key of ['name', 'iban', 'cardNumber', 'cardComment', 'taxId', 'monobankToken']) if (args[key] !== undefined) data[key] = args[key];
      return Object.keys(data).length ? db.fop.update({ where: { id: args.fopId }, data }) : db.fop.findUnique({ where: { id: args.fopId } });
    }
    case 'delete_fop':
      await db.fop.delete({ where: { id: args.fopId } });
      return { id: args.fopId, deleted: true };

    case 'list_products': {
      const where = {
        tenantId: args.tenantId,
        ...(args.categoryId ? { categoryId: args.categoryId } : {}),
        ...(args.supplierId ? { supplierId: args.supplierId } : {}),
        ...(args.isSet !== undefined ? { isSet: !!args.isSet } : {}),
        ...(args.q ? { OR: [{ name: { contains: args.q, mode: 'insensitive' } }, { sku: { contains: args.q, mode: 'insensitive' } }, { adMatchTokens: { has: args.q } }] } : {}),
      };
      const products = await db.product.findMany({ where, include: { offers: true, category: true, supplier: true }, orderBy: { updatedAt: 'desc' } });
      return products.map(withOfferAvailability);
    }
    case 'get_product': {
      const where = args.productId ? { id: args.productId } : { tenantId_sku: { tenantId: args.tenantId, sku: args.sku } };
      const product = await db.product.findUnique({ where, include: { offers: true, category: true, supplier: true, setOf: { include: { componentProduct: true } } } }).catch(() => null);
      if (!product) throw new NotFoundError('Product', args.productId || args.sku);
      return withOfferAvailability(product);
    }
    case 'create_product': {
      if (!args.name || !args.sku || args.price === undefined) throw new ValidationError('name, sku, price обовʼязкові');
      const dup = await db.product.findFirst({ where: { tenantId: args.tenantId, sku: args.sku } });
      if (dup) throw new ConflictError('Товар з таким sku вже існує', { sku: args.sku });
      return db.product.create({
        data: {
          tenantId: args.tenantId, name: args.name, customerName: args.customerName || null, sku: args.sku, price: args.price, minPrice: args.minPrice ?? null,
          categoryId: args.categoryId || null, presentationText: args.presentationText || null,
          adMatchTokens: args.adMatchTokens || [], companionProductIds: args.companionProductIds || [],
          supplierId: args.supplierId || null, supplierArticle: args.supplierArticle || null,
          thumbnailUrl: args.thumbnailUrl || null, images: args.images || [], aiNotes: args.aiNotes || null,
          sizeChartData: args.sizeChartData ?? undefined, bulkPricing: args.bulkPricing || [], isSet: !!args.isSet,
          alwaysAvailable: args.alwaysAvailable !== undefined ? !!args.alwaysAvailable : true,
          outOfStock: !!args.outOfStock,
          sizes: args.sizes || [],
        },
      });
    }
    case 'update_product': {
      const data = {};
      for (const key of ['name', 'customerName', 'sku', 'price', 'minPrice', 'categoryId', 'presentationText', 'adMatchTokens', 'companionProductIds', 'supplierId', 'supplierArticle', 'thumbnailUrl', 'images', 'aiNotes', 'sizeChartData', 'bulkPricing', 'isSet', 'outOfStock', 'alwaysAvailable', 'sizes']) {
        if (args[key] !== undefined) data[key] = args[key];
      }
      if (args.fitChart !== undefined) data.fitChart = normalizeFitChart(args.fitChart);
      if (args.sizeRules !== undefined) data.sizeRules = normalizeSizeRules(args.sizeRules);
      return db.product.update({ where: { id: args.productId }, data });
    }
    case 'delete_product': {
      const count = await db.orderItem.count({ where: { productId: args.productId } });
      if (count > 0) throw new ConflictError('Товар задіяний у замовленнях — видалення заблоковано', { orderItems: count });
      await db.product.delete({ where: { id: args.productId } });
      return { id: args.productId, deleted: true };
    }
    case 'update_set_components': {
      await db.$transaction([
        db.productSetComponent.deleteMany({ where: { parentProductId: args.productId } }),
        ...(args.components.length ? [db.productSetComponent.createMany({ data: args.components.map((c) => ({ parentProductId: args.productId, componentProductId: c.componentProductId, qty: Number(c.qty) || 1, fixedColor: c.fixedColor ? String(c.fixedColor).trim() : null })) })] : []),
      ]);
      return { productId: args.productId, components: args.components };
    }
    case 'create_offer':
      return db.offer.create({ data: { productId: args.productId, sku: args.sku || null, properties: args.properties || [], images: (args.images || []).slice(0, 10), ...(args.availableSizes !== undefined ? { availableSizes: args.availableSizes, sizesCustomized: true } : {}) } });
    case 'update_offer': {
      const data = {};
      for (const key of ['sku', 'properties', 'images']) if (args[key] !== undefined) data[key] = key === 'images' ? args.images.slice(0, 10) : args[key];
      if (args.availableSizes !== undefined) { data.availableSizes = args.availableSizes; data.sizesCustomized = true; }
      return db.offer.update({ where: { id: args.offerId }, data });
    }
    case 'delete_offer':
      await db.offer.delete({ where: { id: args.offerId } });
      return { id: args.offerId, deleted: true };

    case 'list_pipelines':
      return db.pipeline.findMany({ where: { tenantId: args.tenantId }, include: { stages: { orderBy: { order: 'asc' } } } });
    case 'create_pipeline':
      return db.pipeline.create({
        data: { tenantId: args.tenantId, name: args.name, stages: { create: (args.stageNames?.length ? args.stageNames : ['Новий']).map((n, i) => ({ name: n, order: i })) } },
        include: { stages: true },
      });
    case 'create_stage': {
      const max = await db.stage.aggregate({ where: { pipelineId: args.pipelineId }, _max: { order: true } });
      return db.stage.create({ data: { pipelineId: args.pipelineId, name: args.name, order: (max._max.order ?? -1) + 1 } });
    }
    case 'update_stage': {
      const data = {};
      if (args.name !== undefined) data.name = args.name;
      if (args.order !== undefined) data.order = Number(args.order);
      return db.stage.update({ where: { id: args.stageId }, data });
    }
    case 'delete_stage': {
      const count = await db.order.count({ where: { stageId: args.stageId } });
      if (count > 0) throw new ConflictError('На цій стадії є замовлення — спершу перенесіть їх', { orders: count });
      await db.stage.delete({ where: { id: args.stageId } });
      return { id: args.stageId, deleted: true };
    }

    case 'list_orders': {
      const { igSearchTerm } = require('../../api/src/lib/instagram');
      const qs = String(args.q || '').trim();
      const ig = igSearchTerm(qs);
      const or = !qs ? null : ig
        ? [{ contactIg: { equals: ig, mode: 'insensitive' } }, { buyer: { is: { igUsername: { equals: ig, mode: 'insensitive' } } } }]
        : [{ ttn: { has: qs } }, { buyer: { is: { OR: [{ phone: { contains: qs.replace(/[^\d+]/g, '') || qs } }, { fullName: { contains: qs, mode: 'insensitive' } }, { igUsername: { contains: qs.replace(/^@/, ''), mode: 'insensitive' } }] } } }, { contactIg: { contains: qs.replace(/^@/, ''), mode: 'insensitive' } }, { contactName: { contains: qs, mode: 'insensitive' } }];
      const rows = await db.order.findMany({
        where: { tenantId: args.tenantId, ...(args.stageId ? { stageId: args.stageId } : {}), ...(or ? { OR: or } : {}) },
        include: MCP_ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: Math.min(100, Number(args.take) || 30),
      });
      return rows.map(orderView);
    }
    case 'get_order': {
      const o = await db.order.findFirst({ where: { id: args.orderId, tenantId: args.tenantId }, include: MCP_ORDER_INCLUDE });
      if (!o) throw new NotFoundError('Order', args.orderId);
      return orderView(o);
    }
    case 'create_order': {
      const ops = require('../../api/src/lib/orderOps');
      const { igOrNull } = require('../../api/src/lib/instagram');
      if (!Array.isArray(args.items) || !args.items.length) throw new ValidationError('items[] обовʼязкові (хоча б одна позиція)');
      const items = await mcpOrderItems(args.tenantId, args.items);
      const suppliers = await ops.resolveItemSuppliers(args.tenantId, items);
      const pay = ops.paymentFields(args, ops.itemsTotal(items), null, (await db.tenant.findUnique({ where: { id: args.tenantId }, select: { prepaymentAmount: true } }))?.prepaymentAmount);
      const ig = args.buyer ? igOrNull(args.buyer.igUsername) : null;
      let buyerId = null;
      if (args.buyer && args.buyer.phone) {
        const phone = String(args.buyer.phone).replace(/[^\d+]/g, '');
        const buyer = await db.buyer.upsert({
          where: { tenantId_phone: { tenantId: args.tenantId, phone } },
          update: {},
          create: { tenantId: args.tenantId, phone, fullName: args.buyer.fullName || null, igUsername: ig },
        });
        const fill = { ...(!buyer.fullName && args.buyer.fullName ? { fullName: String(args.buyer.fullName) } : {}), ...(!buyer.igUsername && ig ? { igUsername: ig } : {}) };
        if (Object.keys(fill).length) await db.buyer.update({ where: { id: buyer.id }, data: fill });
        buyerId = buyer.id;
      }
      let stageId = await mcpTenantStage(args.tenantId, args.stageId);
      if (!stageId) {
        const pl = await db.pipeline.findFirst({ where: { tenantId: args.tenantId }, orderBy: { createdAt: 'asc' }, include: { stages: { orderBy: { order: 'asc' }, take: 1 } } });
        stageId = pl?.stages?.[0]?.id || null;
      }
      const o = await db.order.create({
        data: {
          tenantId: args.tenantId, buyerId, stageId,
          sourceName: 'Вручну (MCP)',
          managerComment: args.managerComment || null,
          shipping: args.shipping || null,
          ttn: args.ttn !== undefined ? ops.parseTtnList(args.ttn) : [],
          ...(ig ? { contactIg: ig } : {}),
          ...pay,
          items: { create: items.map((it, i) => ({ productId: it.productId || null, offerId: it.offerId || null, name: it.name, price: it.price, quantity: it.quantity, properties: Array.isArray(it.properties) ? it.properties : undefined, isUpsell: !!it.isUpsell, supplierId: suppliers[i] })) },
        },
        include: MCP_ORDER_INCLUDE,
      });
      return orderView(o);
    }
    case 'update_order': {
      const ops = require('../../api/src/lib/orderOps');
      const existing = await db.order.findFirst({ where: { id: args.orderId, tenantId: args.tenantId }, include: { items: { select: { productId: true, supplierId: true, price: true, quantity: true } }, buyer: true } });
      if (!existing) throw new NotFoundError('Order', args.orderId);
      let newItems = null;
      if (args.items !== undefined) {
        if (!Array.isArray(args.items) || !args.items.length) throw new ValidationError('Потрібна хоча б одна позиція');
        const items = await mcpOrderItems(args.tenantId, args.items);
        const suppliers = await ops.resolveItemSuppliers(args.tenantId, items, existing.items);
        newItems = items.map((it, i) => ({ orderId: existing.id, productId: it.productId || null, offerId: it.offerId || null, name: it.name, price: it.price, quantity: it.quantity, properties: Array.isArray(it.properties) && it.properties.length ? it.properties : undefined, components: Array.isArray(it.components) && it.components.length ? it.components : undefined, isUpsell: !!it.isUpsell, supplierId: suppliers[i] }));
      }
      const total = ops.itemsTotal(newItems || existing.items);
      // «Повна передплата» йде за сумою: змінився склад без явного способу оплати — перераховуємо.
      const pay = ops.paymentFields(args.paymentType === undefined && args.prepaymentAmount === undefined && newItems && existing.paymentType === 'full' ? { paymentType: 'full' } : args, total, existing, (await db.tenant.findUnique({ where: { id: args.tenantId }, select: { prepaymentAmount: true } }))?.prepaymentAmount);
      const stageId = args.stageId !== undefined ? await mcpTenantStage(args.tenantId, args.stageId) : undefined;
      const ttnList = args.ttn !== undefined ? ops.parseTtnList(args.ttn) : null;
      const stagePatch = ttnList && stageId === undefined && !args.cancel ? await ops.shippedStagePatch(args.tenantId, existing, existing.ttn, ttnList) : {};
      const buyerPatch = args.buyer !== undefined ? await ops.applyBuyerEdit(args.tenantId, existing, args.buyer) : {};
      const data = {
        ...pay, ...stagePatch, ...buyerPatch,
        ...(stageId !== undefined ? { stageId } : {}),
        ...(args.managerComment !== undefined ? { managerComment: args.managerComment } : {}),
        ...(args.shipping !== undefined ? { shipping: args.shipping, managerEditedAt: new Date() } : {}),
        ...(ttnList ? { ttn: ttnList } : {}),
        ...(newItems ? { managerEditedAt: new Date() } : {}),
      };
      await db.$transaction([
        ...(newItems ? [db.orderItem.deleteMany({ where: { orderId: existing.id } }), db.orderItem.createMany({ data: newItems })] : []),
        db.order.update({ where: { id: existing.id }, data }),
      ]);
      if (args.cancel) await ops.cancelOrder(args.tenantId, existing.id);
      return orderView(await db.order.findFirst({ where: { id: existing.id }, include: MCP_ORDER_INCLUDE }));
    }
    case 'delete_order':
      return require('../../api/src/lib/orderOps').deleteOrder(args.tenantId, args.orderId);
    case 'update_ttn_statuses':
      return require('../../api/src/lib/novaPoshta').syncTtnStatuses(args.tenantId, { ...(Array.isArray(args.orderIds) ? { orderIds: args.orderIds.slice(0, 200) } : {}), moveStages: args.moveStages !== false });

    case 'update_ad_variants':
      if (Array.isArray(args.relinkExternalIds) && args.relinkExternalIds.length) return require('../../api/src/lib/adVariants').relinkVariantsByExternalId(args.tenantId, args.relinkExternalIds.slice(0, 50), { dryRun: !!args.dryRun });
      return require('../../api/src/lib/adVariants').linkAllAdVariants(args.tenantId, { dryRun: !!args.dryRun });
    case 'list_ads':
      return db.ad.findMany({ where: { tenantId: args.tenantId }, include: { product: true } });
    case 'create_ad':
      return db.ad.create({ data: { tenantId: args.tenantId, externalId: args.externalId || null, name: args.name || null, productId: args.productId || null, postId: args.postId || null, postUrl: args.postUrl || null } });
    case 'update_ad': {
      const data = {};
      if (args.productId !== undefined) { data.productId = args.productId || null; data.productLinkSource = args.productId ? 'manual' : null; data.productLinkNote = null; }
      if (args.name !== undefined) data.name = args.name;
      const before = await db.ad.findUnique({ where: { id: args.adId }, select: { tenantId: true, productId: true } });
      const upd = await db.ad.update({ where: { id: args.adId }, data });
      if (before && args.productId !== undefined && (args.productId || null) !== before.productId) await require('../../api/src/lib/adVariants').propagateProductToVariants(before.tenantId, args.adId, args.productId).catch(() => null);
      return upd;
    }

    case 'list_crm_checks':
      return (await require('../../api/src/lib/crmChecks').listChecks(args.tenantId, { status: args.status })).items;
    case 'create_crm_check':
      return require('../../api/src/lib/crmChecks').createCheck(args.tenantId, args);
    case 'update_crm_check':
      return require('../../api/src/lib/crmChecks').updateCheck(args.tenantId, args.checkId, args);

    default:
      throw new NotFoundError('Tool', name);
  }
}

module.exports = { TOOLS, READ_TOOL_NAMES, WRITE_TOOL_NAMES, callTool, safeJsonStringify };
