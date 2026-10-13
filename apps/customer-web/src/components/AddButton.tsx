import { useCart } from '../cart/CartContext';
import type { Product } from '../api/types';

export default function AddButton({ product }: { product: Product }) {
  const cart = useCart();
  const q = cart.qty(product.id);
  if (q === 0) {
    return (
      <div className="add">
        <button className="p1" aria-label={`Add ${product.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); cart.add(product); }}>
          <svg className="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </div>
    );
  }
  return (
    <div className="add has">
      <span className="sp">
        <button aria-label={`One less ${product.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); cart.remove(product); }}>
          <svg className="i" viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
        </button>
        <span className="n bump" key={q}>{q}</span>
        <button aria-label={`One more ${product.name}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); cart.add(product); }}>
          <svg className="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
        </button>
      </span>
    </div>
  );
}
