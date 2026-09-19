import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Delivery } from './pages/Delivery';
import { Login } from './pages/Login';
import { Queue } from './pages/Queue';

/**
 * Route protection is for the rider's benefit only: every rider endpoint is
 * guarded server side by requireAuth + requireRoles('RIDER') + ownership.
 */
function RequireRider({ children }: { children: JSX.Element }) {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <p className="boot" role="status">
        Checking your session…
      </p>
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
        path="/"
        element={
          <RequireRider>
            <Queue />
          </RequireRider>
        }
      />
      <Route
        path="/deliveries/:id"
        element={
          <RequireRider>
            <Delivery />
          </RequireRider>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
