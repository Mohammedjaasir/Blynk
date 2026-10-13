import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { loadAllProducts } from '../lib/loadAllProducts';
import { goBack } from '../lib/goBack';
import { useCart } from '../cart/CartContext';
import { regularTotal, subtotal } from '../cart/cartStore';
import { useStore } from '../store/StoreContext';
import { formatLkr } from '../lib/money';
import { effectivePrice, isOfferActive } from '../lib/pricing';

export default function Cart() {
  const nav = useNavigate();
  const loc = useLocation();
  const cart = useCart();
  const store = useStore();
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    // Refresh prices and availability for what is in the cart.
    // Fetches the whole catalogue (limit 100 per page); Phase 2 replaces this with a server-side check at checkout.
    if (!cart.state.lines.length) return;
    let alive = true;
    loadAllProducts()
      .then((products) => { if (alive) { setRefreshFailed(false); cart.reconcileWith(products); } })
      .catch(() => { if (alive) setRefreshFailed(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!cart.state.lines.length) {
    return (<section className="screen"><div style={{ padding: 40, textAlign: 'center' }}><h2>Your cart is empty</h2><p style={{ color: 'var(--t2)', marginTop: 6 }}>Add your everyday essentials and we'll deliver them to your doorstep.</p><Link to="/" className="big" style={{ marginTop: 18, textDecoration: 'none' }}>Browse groceries</Link></div></section>);
  }
  const sub = subtotal(cart.state), reg = regularTotal(cart.state), saved = Math.round((reg - sub) * 100) / 100;
  const showSavings = store?.show_offer_savings === true;
  const free = store?.new_customer_free_deliveries.enabled ? store.new_customer_free_deliveries.count : 0;
  const feeText = free > 0 ? `FREE · first ${free} deliveries` : store?.delivery_fee_mode === 'FLAT' && store.delivery_fee_lkr != null ? formatLkr(store.delivery_fee_lkr) : 'Calculated at checkout';
  return (
    <section className="screen" style={{ background: 'var(--bg)' }}>
      <div className="sc">
        <div className="c-top"><button onClick={() => goBack(nav, loc.key)} aria-label="Back">←</button><span>Blynk · Dharga Town store</span></div>
        {refreshFailed && <div role="status" style={{ margin: '10px 16px', fontSize: 13, color: 'var(--problem)' }}>Couldn't refresh prices. Check your connection.</div>}
        <div className="strip">{free > 0 ? `Free delivery on your first ${free} deliveries` : 'Cash on delivery'}</div>
        <div className="cbox">
          {cart.state.lines.map((l) => (
            <div className="li" key={l.product.id}>
              <span className="nm">{l.product.name}{!l.product.is_available && <span style={{ display: 'block', color: 'var(--problem)', fontSize: 12.5 }}>Unavailable</span>}</span>
              {l.product.is_available ? (
                <span className="ost"><button aria-label={`One less ${l.product.name}`} onClick={() => cart.remove(l.product)}>−</button><span>{l.quantity}</span><button aria-label={`One more ${l.product.name}`} onClick={() => cart.add(l.product)}>+</button></span>
              ) : <button className="chip" aria-label={`Remove ${l.product.name}`} onClick={() => cart.setQty(l.product, 0)}>Remove</button>}
              <span className="amt">{l.product.is_available && isOfferActive(l.product) && <s>{formatLkr(l.product.selling_price * l.quantity)}</s>}{l.product.is_available ? <span className={isOfferActive(l.product) ? 'hl' : undefined}>{formatLkr(Math.round(effectivePrice(l.product) * l.quantity * 100) / 100)}</span> : ''}</span>
            </div>
          ))}
          <div className="chips"><Link to="/" className="chip">+ Add items</Link></div>
        </div>
        {showSavings && saved > 0 && <div className="cbox"><div className="ap"><span className="grow">{formatLkr(saved)} saved with offer prices</span><span className="ok">Applied</span></div></div>}
        <div className="cbox paybox">
          <div className="bill">
            <div className="r"><u>Item total</u><span>{showSavings && saved > 0 && <s style={{ color: 'var(--strike)' }}>{formatLkr(reg)} </s>}<span data-testid="cart-total">{formatLkr(sub)}</span></span></div>
            <div className="r"><u>Delivery fee</u><span>{feeText}</span></div>
          </div>
        </div>
        <div style={{ margin: '16px 18px', fontSize: 13, color: 'var(--t3)' }}><b style={{ color: 'var(--t2)', fontWeight: 500 }}>Cancellation policy:</b><br />You can cancel your order until it is out for delivery.</div>
      </div>
      <div className="foot"><h3>Almost there</h3><p>Login or create an account quickly to place your order</p><button className="big" onClick={() => nav('/login')}>Proceed with phone number</button></div>
    </section>
  );
}
