import { Routes, Route } from 'react-router-dom';
import PhoneOnly, { isDesktopBlocked } from './pages/PhoneOnly';
import { StoreProvider } from './store/StoreContext';
import { CartProvider } from './cart/CartContext';
import Home from './pages/Home';
import Aisle from './pages/Aisle';
import ProductPage from './pages/ProductPage';

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
            <Route path="*" element={<div />} />
          </Routes>
        </div>
      </CartProvider>
    </StoreProvider>
  );
}
