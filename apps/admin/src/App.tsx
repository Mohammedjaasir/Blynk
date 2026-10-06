import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { Cash } from './pages/Cash';
import { Categories } from './pages/Categories';
import { CategoryGroups } from './pages/CategoryGroups';
import { Coupons } from './pages/Coupons';
import { CustomerDetail, Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { Feedback } from './pages/Feedback';
import { Login } from './pages/Login';
import { Orders } from './pages/Orders';
import { ProductForm } from './pages/ProductForm';
import { ProductImport } from './pages/ProductImport';
import { Products } from './pages/Products';
import { Promotions } from './pages/Promotions';
import { Sales } from './pages/Sales';
import { Settings } from './pages/Settings';
import { SmsOffers } from './pages/SmsOffers';
import { Staff } from './pages/Staff';

/**
 * Route protection here is for the operator's benefit only. Every admin
 * endpoint is guarded server side by requireAuth + requireRoles, so a
 * hand-crafted request from the wrong role is rejected by the API whatever
 * this router does.
 */
function RequireOperations({ children }: { children: JSX.Element }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="boot">
        <Spinner label="Checking your session" />
      </div>
    );
  }
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return children;
}

/** Admin-only screens; packing staff are taken to Orders instead. */
function AdminOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') return <Navigate to="/orders" replace />;
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireOperations>
            <Layout />
          </RequireOperations>
        }
      >
        <Route index element={<AdminOnly><Dashboard /></AdminOnly>} />
        <Route path="orders" element={<Orders />} />
        <Route path="products" element={<AdminOnly><Products /></AdminOnly>} />
        <Route path="products/new" element={<AdminOnly><ProductForm /></AdminOnly>} />
        <Route path="products/import" element={<AdminOnly><ProductImport /></AdminOnly>} />
        <Route path="products/:id" element={<AdminOnly><ProductForm /></AdminOnly>} />
        <Route path="categories" element={<AdminOnly><Categories /></AdminOnly>} />
        <Route path="category-groups" element={<AdminOnly><CategoryGroups /></AdminOnly>} />
        <Route path="promotions" element={<AdminOnly><Promotions /></AdminOnly>} />
        <Route path="sales" element={<AdminOnly><Sales /></AdminOnly>} />
        <Route path="cash" element={<AdminOnly><Cash /></AdminOnly>} />
        <Route path="coupons" element={<AdminOnly><Coupons /></AdminOnly>} />
        <Route path="customers" element={<AdminOnly><Customers /></AdminOnly>} />
        <Route path="customers/:id" element={<AdminOnly><CustomerDetail /></AdminOnly>} />
        <Route path="sms-offers" element={<AdminOnly><SmsOffers /></AdminOnly>} />
        <Route path="feedback" element={<AdminOnly><Feedback /></AdminOnly>} />
        <Route path="staff" element={<AdminOnly><Staff /></AdminOnly>} />
        <Route path="settings" element={<AdminOnly><Settings /></AdminOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
