import { Routes, Route, Navigate } from 'react-router-dom';
import PhoneOnly, { isDesktopBlocked } from './pages/PhoneOnly';
import { StoreProvider } from './store/StoreContext';
import { CartProvider } from './cart/CartContext';
import Home from './pages/Home';
import Aisle from './pages/Aisle';
import ProductPage from './pages/ProductPage';
import Search from './pages/Search';
import Cart from './pages/Cart';
import CartBar from './components/CartBar';

export default function App() {
  if (typeof window !== 'undefined' && isDesktopBlocked(window.innerWidth, window.location.search)) return <PhoneOnly />;
  return (
    <StoreProvider>
      <CartProvider>
        <div className="app" data-testid="app-shell">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/aisle/:slug" element={<Aisle />} />
            <Route path="/p/:id" element={<ProductPage />} />
            <Route path="/search" element={<Search />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/login" element={<div style={{ padding: 40, textAlign: 'center' }}>Sign-in comes in the next update.</div>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <CartBar />
        </div>
      </CartProvider>
    </StoreProvider>
  );
}
