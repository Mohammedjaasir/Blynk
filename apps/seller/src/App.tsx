import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { SellerProvider } from './auth/SellerContext';
import { Layout } from './components/Layout';
import { PageLoading } from './components/ui';
import { ProductForm } from './pages/ProductForm';
import { Products } from './pages/Products';
import { Shop } from './pages/Shop';
import { SignIn } from './pages/SignIn';
import { Statement } from './pages/Statement';
import { Stock } from './pages/Stock';

/**
 * Route protection here is for the seller's benefit only. Every /seller
 * endpoint is guarded server side by requireAuth + requireRoles('SELLER'), so
 * a hand-made request from anyone else is rejected by the API whatever this
 * router does.
 */
function RequireSeller({ children }: { children: JSX.Element }) {
  const { status, retry } = useAuth();
  if (status === 'unreachable') {
    return (
      <div className="boot">
        <p role="status">Could not reach Blynk to check your sign-in. Check your internet.</p>
        <button type="button" className="button button--primary" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="boot">
        <PageLoading label="Checking your sign-in" />
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/sign-in" replace />;
  return children;
}

function SignInRoute() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/products" replace />;
  if (status === 'loading') {
    return (
      <div className="boot">
        <PageLoading label="Checking your sign-in" />
      </div>
    );
  }
  return <SignIn />;
}

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

/** The routes without a router, so tests can mount them in a MemoryRouter. */
export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/sign-in" element={<SignInRoute />} />
        <Route
          element={
            <RequireSeller>
              <SellerProvider>
                <Layout />
              </SellerProvider>
            </RequireSeller>
          }
        >
          <Route path="/products" element={<Products />} />
          <Route path="/products/new" element={<ProductForm mode="new" />} />
          <Route path="/products/:id/edit" element={<ProductForm mode="edit" />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/statement" element={<Statement />} />
          <Route path="/shop" element={<Shop />} />
        </Route>
        <Route path="*" element={<Navigate to="/products" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export function App() {
  return (
    <BrowserRouter future={ROUTER_FUTURE}>
      <AppRoutes />
    </BrowserRouter>
  );
}
