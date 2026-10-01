import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Welcome, hasSeenIntro } from './pages/Welcome';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Delivery } from './pages/Delivery';
import { Login } from './pages/Login';
import { MyDay } from './pages/MyDay';
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

/**
 * The welcome screen opens on every launch (2026-09-28, as in Blynk Ops): the
 * first navigation of a launch goes to /welcome, carrying where it was headed.
 */
function IntroGate({ children }: { children: JSX.Element }) {
  const location = useLocation();
  if (!hasSeenIntro() && location.pathname !== '/welcome') {
    return <Navigate to="/welcome" replace state={{ from: location }} />;
  }
  return children;
}

export function AppRoutes() {
  return (
    <IntroGate>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<Welcome />} />
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
      <Route
        path="/day"
        element={
          <RequireRider>
            <MyDay />
          </RequireRider>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </IntroGate>
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
