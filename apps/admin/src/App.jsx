import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import Layout from './components/layout/Layout';
import Login from './pages/Login';
import NoAccess from './pages/NoAccess';
import ProductsPage from './pages/ProductsPage';
import SetsPage from './pages/SetsPage';
import CategoriesPage from './pages/CategoriesPage';
import SuppliersPage from './pages/SuppliersPage';
import FopsPage from './pages/FopsPage';
import SettingsKeysPage from './pages/SettingsKeysPage';
import PipelinesPage from './pages/PipelinesPage';
import OrdersPage from './pages/OrdersPage';
import BuyersPage from './pages/BuyersPage';
import ReturnsPage from './pages/ReturnsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import DailyAnalyticsPage from './pages/DailyAnalyticsPage';
import AdSpendPage from './pages/AdSpendPage';
import PaymentsPage from './pages/PaymentsPage';
import ProductExpensesPage from './pages/ProductExpensesPage';
import SettingsGeneralPage from './pages/SettingsGeneralPage';
import SettingsIntegrationsPage from './pages/SettingsIntegrationsPage';

function ProtectedShell({ children }) {
  const { isLoading, isAuthenticated, tenants } = useAuthStore();
  if (isLoading) return null;
  if (!isAuthenticated) return <Login />;
  if (tenants.length === 0) return <NoAccess />;
  return children;
}

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);
  useEffect(() => { fetchMe(); }, [fetchMe]);

  return (
    <BrowserRouter>
      <ProtectedShell>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/orders" replace />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/sets" element={<SetsPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/fops" element={<FopsPage />} />
            <Route path="/pipelines" element={<PipelinesPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/buyers" element={<BuyersPage />} />
            <Route path="/returns" element={<ReturnsPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/daily-analytics" element={<DailyAnalyticsPage />} />
            <Route path="/ad-spend" element={<AdSpendPage />} />
            <Route path="/payments" element={<PaymentsPage />} />
            <Route path="/product-expenses" element={<ProductExpensesPage />} />
            <Route path="/settings/general" element={<SettingsGeneralPage />} />
            <Route path="/settings/integrations" element={<SettingsIntegrationsPage />} />
            <Route path="/settings/keys" element={<SettingsKeysPage />} />
            <Route path="*" element={<Navigate to="/orders" replace />} />
          </Route>
        </Routes>
      </ProtectedShell>
    </BrowserRouter>
  );
}
