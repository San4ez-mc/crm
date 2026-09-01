// Fineko CRM MCP tools — той самий патерн, що platform/apps/mcp/src/tools-flows.js:
// один файл TOOLS[] (JSON Schema) + callTool(name,args) диспетчер.
// Призначення (§5 ТЗ): НАЛАШТУВАННЯ — товари, категорії, постачальники, стадії pipeline,
// рекламні акаунти. Рантайм-операції воронки (lookup/create_order) йдуть через REST API
// з Bearer tenant.apiKey — MCP працює крос-тенантно з explicit tenantId в кожному тулі.
const { db } = require('@crm/db');
const { NotFoundError, ValidationError, ConflictError } = require('@crm/errors');

function safeJsonStringify(value) {
  return JSON.stringify(value, (key, v) => (typeof v === 'bigint' ? v.toString() : v));
}

const TOOLS = [
  // ── Tenants ──────────────────────────────────────────────────────────
  { name: 'list_tenants', description: 'Список усіх магазинів (tenants) СРМ.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_tenant', description: 'Деталі одного tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'new_tenant', description: 'Створити новий магазин (tenant).', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },

  // ── Category §4.5 ────────────────────────────────────────────────────
  { name: 'list_categories', description: 'Категорії товарів tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_category', description: 'Створити категорію.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, aiInstructions: { type: 'string', description: 'Що бот має дізнатись у клієнта для товарів цієї категорії' } }, required: ['tenantId', 'name'] } },
  { name: 'update_category', description: 'Оновити категорію.', inputSchema: { type: 'object', properties: { categoryId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, aiInstructions: { type: 'string' } }, required: ['categoryId'] } },
  { name: 'delete_category', description: 'Видалити категорію (лише якщо немає товарів).', inputSchema: { type: 'object', properties: { categoryId: { type: 'string' } }, required: ['categoryId'] } },

  // ── Supplier §4.4 ────────────────────────────────────────────────────
  { name: 'list_suppliers', description: 'Постачальники tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_supplier', description: 'Створити постачальника.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, mechanism: { type: 'string', description: 'ручне / EasyDrop / BrewDrop / інше' }, contactInfo: { type: 'string' }, description: { type: 'string' }, aiNotes: { type: 'string' }, website: { type: 'string' }, telegramGroupId: { type: 'string' }, loginUsername: { type: 'string' }, loginPassword: { type: 'string' } }, required: ['tenantId', 'name'] } },
  { name: 'update_supplier', description: 'Оновити постачальника.', inputSchema: { type: 'object', properties: { supplierId: { type: 'string' }, name: { type: 'string' }, mechanism: { type: 'string' }, contactInfo: { type: 'string' }, description: { type: 'string' }, aiNotes: { type: 'string' }, website: { type: 'string' }, telegramGroupId: { type: 'string' }, loginUsername: { type: 'string' }, loginPassword: { type: 'string' } }, required: ['supplierId'] } },
  { name: 'delete_supplier', description: 'Видалити постачальника (лише якщо немає товарів).', inputSchema: { type: 'object', properties: { supplierId: { type: 'string' } }, required: ['supplierId'] } },

  // ── Fop (ФОП для прийому оплат) — окремо per-tenant ─────────────────
  { name: 'list_fops', description: 'ФОПи tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_fop', description: 'Створити ФОП.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, iban: { type: 'string' }, taxId: { type: 'string', description: 'ІПН' }, monobankToken: { type: 'string' } }, required: ['tenantId', 'name'] } },
  { name: 'update_fop', description: 'Оновити ФОП. isActive:true робить його єдиним активним для tenant (деактивує інші).', inputSchema: { type: 'object', properties: { fopId: { type: 'string' }, name: { type: 'string' }, iban: { type: 'string' }, taxId: { type: 'string' }, monobankToken: { type: 'string' }, isActive: { type: 'boolean' } }, required: ['fopId'] } },
  { name: 'delete_fop', description: 'Видалити ФОП.', inputSchema: { type: 'object', properties: { fopId: { type: 'string' } }, required: ['fopId'] } },

  // ── Product / Offer §4.2/§4.3 ───────────────────────────────────────
  { name: 'list_products', description: 'Каталог товарів з варіантами (offers) і фото.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, q: { type: 'string' }, categoryId: { type: 'string' }, supplierId: { type: 'string' }, isSet: { type: 'boolean', description: 'фільтр: тільки комплекти (true) чи тільки звичайні товари (false)' } }, required: ['tenantId'] } },
  { name: 'get_product', description: 'Товар за id або sku.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, productId: { type: 'string' }, sku: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_product', description: 'Створити товар.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, sku: { type: 'string' }, price: { type: 'number' }, minPrice: { type: 'number' }, categoryId: { type: 'string' }, presentationText: { type: 'string', description: 'Готовий текст-презентація, бот показує verbatim' }, adMatchTokens: { type: 'array', items: { type: 'string' } }, companionProductIds: { type: 'array', items: { type: 'string' } }, supplierId: { type: 'string' }, supplierArticle: { type: 'string' }, thumbnailUrl: { type: 'string' }, images: { type: 'array', items: { type: 'string' } }, aiNotes: { type: 'string', description: 'Нотатки для бота (не показуються клієнту)' }, sizeChartData: { type: 'object', description: '{title,unit,sizes[],measurements}' }, bulkPricing: { type: 'array', items: { type: 'object', properties: { quantity: { type: 'number' }, price: { type: 'number' } } }, description: 'Ціна за кількість — однакова для всіх варіантів кольору' }, isSet: { type: 'boolean', description: 'true = це комплект (окремий пункт меню, не категорія)' } }, required: ['tenantId', 'name', 'sku', 'price'] } },
  { name: 'update_product', description: 'Оновити товар (часткове).', inputSchema: { type: 'object', properties: { productId: { type: 'string' }, name: { type: 'string' }, sku: { type: 'string' }, price: { type: 'number' }, minPrice: { type: 'number' }, categoryId: { type: 'string' }, presentationText: { type: 'string' }, adMatchTokens: { type: 'array', items: { type: 'string' } }, companionProductIds: { type: 'array', items: { type: 'string' } }, supplierId: { type: 'string' }, supplierArticle: { type: 'string' }, thumbnailUrl: { type: 'string' }, images: { type: 'array', items: { type: 'string' } }, aiNotes: { type: 'string' }, sizeChartData: { type: 'object' }, bulkPricing: { type: 'array', items: { type: 'object', properties: { quantity: { type: 'number' }, price: { type: 'number' } } } }, isSet: { type: 'boolean' } }, required: ['productId'] } },
  { name: 'delete_product', description: 'Видалити товар (лише якщо не задіяний у замовленнях).', inputSchema: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] } },
  { name: 'update_set_components', description: 'Задати склад набору {componentProductId,qty}[] — повна заміна.', inputSchema: { type: 'object', properties: { productId: { type: 'string' }, components: { type: 'array', items: { type: 'object', properties: { componentProductId: { type: 'string' }, qty: { type: 'number' } } } } }, required: ['productId', 'components'] } },
  { name: 'create_offer', description: 'Додати варіант товару (колір/розмір). Ціна лишається спільною на товарі — тут тільки кількість цього конкретного варіанту.', inputSchema: { type: 'object', properties: { productId: { type: 'string' }, sku: { type: 'string' }, quantity: { type: 'number', description: 'Кількість саме цього кольору/розміру' }, properties: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } } }, images: { type: 'array', items: { type: 'string' }, description: 'до 10 URL, перший = головне фото' } }, required: ['productId'] } },
  { name: 'update_offer', description: 'Оновити варіант товару.', inputSchema: { type: 'object', properties: { offerId: { type: 'string' }, sku: { type: 'string' }, quantity: { type: 'number' }, properties: { type: 'array' }, images: { type: 'array', items: { type: 'string' } } }, required: ['offerId'] } },
  { name: 'delete_offer', description: 'Видалити варіант товару.', inputSchema: { type: 'object', properties: { offerId: { type: 'string' } }, required: ['offerId'] } },

  // ── Pipeline / Stage §4.7 ────────────────────────────────────────────
  { name: 'list_pipelines', description: 'Воронки (pipeline) зі стадіями tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_pipeline', description: 'Створити воронку зі стадіями.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, name: { type: 'string' }, stageNames: { type: 'array', items: { type: 'string' } } }, required: ['tenantId', 'name'] } },
  { name: 'create_stage', description: 'Додати стадію в кінець воронки.', inputSchema: { type: 'object', properties: { pipelineId: { type: 'string' }, name: { type: 'string' } }, required: ['pipelineId', 'name'] } },
  { name: 'update_stage', description: 'Перейменувати/переставити стадію.', inputSchema: { type: 'object', properties: { stageId: { type: 'string' }, name: { type: 'string' }, order: { type: 'number' } }, required: ['stageId'] } },
  { name: 'delete_stage', description: 'Видалити стадію (лише якщо немає замовлень на ній).', inputSchema: { type: 'object', properties: { stageId: { type: 'string' } }, required: ['stageId'] } },

  // ── Ad §4.9 — підключення рекламних кабінетів/оголошень ─────────────
  { name: 'list_ads', description: 'Оголошення tenant.', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'create_ad', description: 'Зареєструвати оголошення (з рекламного кабінету).', inputSchema: { type: 'object', properties: { tenantId: { type: 'string' }, externalId: { type: 'string' }, name: { type: 'string' }, productId: { type: 'string' } }, required: ['tenantId'] } },
  { name: 'update_ad', description: 'Прив\'язати оголошення до товару / перейменувати.', inputSchema: { type: 'object', properties: { adId: { type: 'string' }, productId: { type: 'string' }, name: { type: 'string' } }, required: ['adId'] } },
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
    case 'new_tenant':
      if (!args.name) throw new ValidationError('name обовʼязкове');
      return db.tenant.create({ data: { name: args.name } });

    case 'list_categories':
      return db.category.findMany({ where: { tenantId: args.tenantId }, orderBy: { name: 'asc' } });
    case 'create_category':
      if (!args.name) throw new ValidationError('name обовʼязкове');
      return db.category.create({ data: { tenantId: args.tenantId, name: args.name, description: args.description || null, aiInstructions: args.aiInstructions || null } });
    case 'update_category':
      return db.category.update({
        where: { id: args.categoryId },
        data: { ...(args.name !== undefined ? { name: args.name } : {}), ...(args.description !== undefined ? { description: args.description } : {}), ...(args.aiInstructions !== undefined ? { aiInstructions: args.aiInstructions } : {}) },
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
      return db.fop.create({ data: { tenantId: args.tenantId, name: args.name, iban: args.iban || null, taxId: args.taxId || null, monobankToken: args.monobankToken || null } });
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
      for (const key of ['name', 'iban', 'taxId', 'monobankToken']) if (args[key] !== undefined) data[key] = args[key];
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
      return db.product.findMany({ where, include: { offers: true, category: true, supplier: true }, orderBy: { updatedAt: 'desc' } });
    }
    case 'get_product': {
      const where = args.productId ? { id: args.productId } : { tenantId_sku: { tenantId: args.tenantId, sku: args.sku } };
      const product = await db.product.findUnique({ where, include: { offers: true, category: true, supplier: true, setOf: { include: { componentProduct: true } } } }).catch(() => null);
      if (!product) throw new NotFoundError('Product', args.productId || args.sku);
      return product;
    }
    case 'create_product': {
      if (!args.name || !args.sku || args.price === undefined) throw new ValidationError('name, sku, price обовʼязкові');
      const dup = await db.product.findFirst({ where: { tenantId: args.tenantId, sku: args.sku } });
      if (dup) throw new ConflictError('Товар з таким sku вже існує', { sku: args.sku });
      return db.product.create({
        data: {
          tenantId: args.tenantId, name: args.name, sku: args.sku, price: args.price, minPrice: args.minPrice ?? null,
          categoryId: args.categoryId || null, presentationText: args.presentationText || null,
          adMatchTokens: args.adMatchTokens || [], companionProductIds: args.companionProductIds || [],
          supplierId: args.supplierId || null, supplierArticle: args.supplierArticle || null,
          thumbnailUrl: args.thumbnailUrl || null, images: args.images || [], aiNotes: args.aiNotes || null,
          sizeChartData: args.sizeChartData ?? undefined, bulkPricing: args.bulkPricing || [], isSet: !!args.isSet,
        },
      });
    }
    case 'update_product': {
      const data = {};
      for (const key of ['name', 'sku', 'price', 'minPrice', 'categoryId', 'presentationText', 'adMatchTokens', 'companionProductIds', 'supplierId', 'supplierArticle', 'thumbnailUrl', 'images', 'aiNotes', 'sizeChartData', 'bulkPricing', 'isSet']) {
        if (args[key] !== undefined) data[key] = args[key];
      }
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
        ...(args.components.length ? [db.productSetComponent.createMany({ data: args.components.map((c) => ({ parentProductId: args.productId, componentProductId: c.componentProductId, qty: Number(c.qty) || 1 })) })] : []),
      ]);
      return { productId: args.productId, components: args.components };
    }
    case 'create_offer':
      return db.offer.create({ data: { productId: args.productId, sku: args.sku || null, quantity: args.quantity ?? null, properties: args.properties || [], images: (args.images || []).slice(0, 10) } });
    case 'update_offer': {
      const data = {};
      for (const key of ['sku', 'quantity', 'properties', 'images']) if (args[key] !== undefined) data[key] = key === 'images' ? args.images.slice(0, 10) : args[key];
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

    case 'list_ads':
      return db.ad.findMany({ where: { tenantId: args.tenantId }, include: { product: true } });
    case 'create_ad':
      return db.ad.create({ data: { tenantId: args.tenantId, externalId: args.externalId || null, name: args.name || null, productId: args.productId || null } });
    case 'update_ad': {
      const data = {};
      if (args.productId !== undefined) data.productId = args.productId || null;
      if (args.name !== undefined) data.name = args.name;
      return db.ad.update({ where: { id: args.adId }, data });
    }

    default:
      throw new NotFoundError('Tool', name);
  }
}

module.exports = { TOOLS, READ_TOOL_NAMES, WRITE_TOOL_NAMES, callTool, safeJsonStringify };
