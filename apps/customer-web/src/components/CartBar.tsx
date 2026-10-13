import { useLocation, Link } from 'react-router-dom';
import { useCart } from '../cart/CartContext';
import { useStore } from '../store/StoreContext';
import { formatLkr } from '../lib/money';

const SHOW_ON = [/^\/$/, /^\/aisle\//, /^\/search/];
export default function CartBar() {
  const { pathname } = useLocation();
  const cart = useCart();
  const store = useStore();
  if (!cart.count || !SHOW_ON.some((r) => r.test(pathname))) return null;
  return (
    <div className="cbw show" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20 }}>
      <Link to="/cart" className="cbar" style={{ display: 'block', textDecoration: 'none' }}>
        {store?.new_customer_free_deliveries.enabled && <div className="yay show">Yay! Your first deliveries are free</div>}
        <div className="mn"><span>{cart.count} {cart.count === 1 ? 'item' : 'items'}</span><span className="sep">|</span><span>{formatLkr(cart.subtotal)}</span><span className="grow" />View cart</div>
      </Link>
    </div>
  );
}
