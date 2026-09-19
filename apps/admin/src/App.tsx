import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { Categories } from './pages/Categories';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Orders } from './pages/Orders';
import { ProductForm } from './pages/ProductForm';
import { Products } from './pages/Products';
import { Promotions } from './pages/Promotions';

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
        <Route path="products/:id" element={<AdminOnly><ProductForm /></AdminOnly>} />
        <Route path="categories" element={<AdminOnly><Categories /></AdminOnly>} />
        <Route path="promotions" element={<AdminOnly><Promotions /></AdminOnly>} />
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
