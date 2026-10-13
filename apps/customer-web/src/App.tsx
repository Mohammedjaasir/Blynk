import { Routes, Route } from 'react-router-dom';
import PhoneOnly, { isDesktopBlocked } from './pages/PhoneOnly';
import { StoreProvider } from './store/StoreContext';
import { CartProvider } from './cart/CartContext';
import Home from './pages/Home';

export default function App() {
  if (typeof window !== 'undefined' && isDesktopBlocked(window.innerWidth, window.location.search)) return <PhoneOnly />;
  return (
    <StoreProvider>
      <CartProvider>
        <div className="app" data-testid="app-shell">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="*" element={<div />} />
          </Routes>
        </div>
      </CartProvider>
    </StoreProvider>
  );
}
