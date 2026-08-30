// Стан автентифікації + вибраний tenant (магазин). SSO-сесія живе в httpOnly cookie
// на боці API (crm_session) — тут тримаємо лише те, що показуємо в UI.
import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  isLoading: true,
  isAuthenticated: false,
  user: null,
  role: 'none',
  tenants: [],
  currentTenantId: localStorage.getItem('crm_tenant_id') || null,

  setTenant(tenantId) {
    localStorage.setItem('crm_tenant_id', tenantId);
    set({ currentTenantId: tenantId });
  },

  async fetchMe() {
    set({ isLoading: true });
    try {
      const res = await fetch('/me', { credentials: 'include' });
      if (!res.ok) throw new Error('unauthenticated');
      const json = await res.json();
      const tenants = json.data.tenants || [];
      const saved = get().currentTenantId;
      const currentTenantId = tenants.some((t) => t.id === saved) ? saved : (tenants[0]?.id || null);
      if (currentTenantId) localStorage.setItem('crm_tenant_id', currentTenantId);
      set({ isAuthenticated: true, user: json.data.user, role: json.data.role, tenants, currentTenantId, isLoading: false });
    } catch {
      set({ isAuthenticated: false, user: null, tenants: [], isLoading: false });
    }
  },

  async logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    set({ isAuthenticated: false, user: null, tenants: [] });
  },
}));
