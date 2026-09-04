// Тонкий fetch-wrapper — той самий патерн, що platform/apps/admin/src/api/client.js.
// tenantId підставляється автоматично з authStore (SSO-сесія скоупиться по вибраному магазину).
import { useAuthStore } from '../stores/authStore';

function withTenant(path) {
  const tenantId = useAuthStore.getState().currentTenantId;
  if (!tenantId) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}tenantId=${encodeURIComponent(tenantId)}`;
}

async function req(method, path, body) {
  const res = await fetch(`/api${withTenant(path)}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, error: { message: 'Invalid JSON response' } }));
  if (!json.ok) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`);
    err.code = json.error?.code;
    err.context = json.error?.context;
    throw err;
  }
  return json;
}

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api${withTenant('/uploads')}`, { method: 'POST', credentials: 'include', body: form });
  const json = await res.json().catch(() => ({ ok: false, error: { message: 'Invalid JSON response' } }));
  if (!json.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  return json.data.url;
}

const get = (path) => req('GET', path);
const post = (path, body) => req('POST', path, body);
const patch = (path, body) => req('PATCH', path, body);
const put = (path, body) => req('PUT', path, body);
const del = (path) => req('DELETE', path);

export const api = {
  // Каталог
  listCategories: () => get('/categories'),
  createCategory: (data) => post('/categories', data),
  updateCategory: (id, data) => patch(`/categories/${id}`, data),
  deleteCategory: (id) => del(`/categories/${id}`),

  listSuppliers: () => get('/suppliers'),
  createSupplier: (data) => post('/suppliers', data),
  updateSupplier: (id, data) => patch(`/suppliers/${id}`, data),
  deleteSupplier: (id) => del(`/suppliers/${id}`),

  listFops: () => get('/fops'),
  createFop: (data) => post('/fops', data),
  updateFop: (id, data) => patch(`/fops/${id}`, data),
  deleteFop: (id) => del(`/fops/${id}`),
  activateFop: (id) => post(`/fops/${id}/activate`),

  listSecrets: () => get('/secrets'),
  getSecret: (id) => get(`/secrets/${id}`),
  createSecret: (data) => post('/secrets', data),
  updateSecret: (id, data) => patch(`/secrets/${id}`, data),
  deleteSecret: (id) => del(`/secrets/${id}`),

  listProducts: (params = {}) => get(`/products?${new URLSearchParams(params)}`),
  getProduct: (id) => get(`/products/${id}`),
  createProduct: (data) => post('/products', data),
  updateProduct: (id, data) => patch(`/products/${id}`, data),
  deleteProduct: (id) => del(`/products/${id}`),
  setSetComponents: (id, components) => put(`/products/${id}/set-components`, { components }),
  createOffer: (productId, data) => post(`/products/${productId}/offers`, data),
  updateOffer: (id, data) => patch(`/offers/${id}`, data),
  deleteOffer: (id) => del(`/offers/${id}`),

  // Продажі
  listBuyers: (params = {}) => get(`/buyers?${new URLSearchParams(params)}`),
  getBuyer: (id) => get(`/buyers/${id}`),
  updateBuyer: (id, data) => patch(`/buyers/${id}`, data),

  listPipelines: () => get('/pipelines'),
  createPipeline: (data) => post('/pipelines', data),
  createStage: (pipelineId, data) => post(`/pipelines/${pipelineId}/stages`, data),
  updateStage: (id, data) => patch(`/stages/${id}`, data),
  deleteStage: (id) => del(`/stages/${id}`),

  listOrders: (params = {}) => get(`/orders?${new URLSearchParams(params)}`),
  getOrder: (id) => get(`/orders/${id}`),
  createOrder: (data) => post('/orders', data),
  updateOrder: (id, data) => patch(`/orders/${id}`, data),

  listReturns: () => get('/returns'),
  createReturn: (data) => post('/returns', data),
  updateReturn: (id, data) => patch(`/returns/${id}`, data),

  listPayments: () => get('/payments'),

  // Реклама/фінанси
  listAds: (params = {}) => get(`/ads?${new URLSearchParams(params)}`),
  createAd: (data) => post('/ads', data),
  updateAd: (id, data) => patch(`/ads/${id}`, data),
  listAdSpend: (params = {}) => get(`/ad-spend?${new URLSearchParams(params)}`),
  syncAdSpendNow: () => post('/ad-spend/sync-now'),
  getAdSpendSummary: (params = {}) => get(`/ads/spend-summary?${new URLSearchParams(params)}`),
  getAdDetail: (id, params = {}) => get(`/ads/${id}/detail?${new URLSearchParams(params)}`),

  listFunnelSlugs: () => get('/funnel-events/funnels'),
  getFunnelSummary: (params = {}) => get(`/funnel-events/summary?${new URLSearchParams(params)}`),
  getFunnelStuck: (params = {}) => get(`/funnel-events/stuck?${new URLSearchParams(params)}`),

  listProductExpenses: (params = {}) => get(`/product-expenses?${new URLSearchParams(params)}`),
  updateProductExpense: (productId, data) => put(`/product-expenses/${productId}`, data),

  // Аналітика
  analyticsTopProducts: (params = {}) => get(`/analytics/top-products?${new URLSearchParams(params)}`),
  analyticsAdsConversion: (params = {}) => get(`/analytics/ads-conversion?${new URLSearchParams(params)}`),
  analyticsMargin: (params = {}) => get(`/analytics/margin?${new URLSearchParams(params)}`),
  analyticsUpsells: (params = {}) => get(`/analytics/upsells?${new URLSearchParams(params)}`),
  analyticsTimeToPurchase: (params = {}) => get(`/analytics/time-to-purchase?${new URLSearchParams(params)}`),
  analyticsDaily: (params = {}) => get(`/analytics/daily?${new URLSearchParams(params)}`),
  analyticsProductDaily: (params = {}) => get(`/analytics/product-daily?${new URLSearchParams(params)}`),

  // База знань
  getKnowledgeProfile: () => get('/knowledge/profile'),
  updateKnowledgeProfile: (data) => put('/knowledge/profile', data),
  listKnowledge: (params = {}) => get(`/knowledge?${new URLSearchParams(params)}`),
  createKnowledge: (data) => post('/knowledge', data),
  updateKnowledge: (id, data) => patch(`/knowledge/${id}`, data),
  deleteKnowledge: (id) => del(`/knowledge/${id}`),
  searchKnowledge: (params = {}) => get(`/knowledge/search?${new URLSearchParams(params)}`),
  importKnowledge: (data) => post('/knowledge/import', data),

  // Налаштування
  getTenantSettings: () => get('/tenant'),
  updateTenantSettings: (data) => patch('/tenant', data),
  regenerateApiKey: () => post('/tenant/regenerate-key'),
  zernioStatus: () => get('/integrations/zernio-status'),
  uploadFile,
};
