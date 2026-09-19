import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner, ToastProvider } from './components/ui';
import { Ledger } from './pages/Ledger';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { SourcingQueue } from './pages/SourcingQueue';
import { Stock } from './pages/Stock';
import { Suppliers } from './pages/Suppliers';

/**
 * Route protection is for the operator's benefit only: every inventory
 * endpoint is guarded server side by requireAuth + requireRoles.
 */
function RequireInventoryUser({ children }: { children: JSX.Element }) {
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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireInventoryUser>
            <Layout />
          </RequireInventoryUser>
        }
      >
        <Route index element={<Overview />} />
        <Route path="stock" element={<Stock />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="sourcing" element={<SourcingQueue />} />
        <Route path="suppliers" element={<Suppliers />} />
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
