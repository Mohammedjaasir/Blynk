import { Link } from 'react-router-dom';
import type { Product } from '../api/types';
import { formatLkr } from '../lib/money';
import { isOfferActive, effectivePrice, savingsPerUnit } from '../lib/pricing';
import { useStore } from '../store/StoreContext';
import AddButton from './AddButton';

export default function ProductCard({ product: p, width }: { product: Product; width?: number }) {
  const store = useStore();
  const offer = isOfferActive(p);
  const pct = offer ? Math.round((1 - effectivePrice(p) / p.selling_price) * 100) : 0;
  return (
    <Link to={`/p/${p.id}`} className="pc" style={{ width, textDecoration: 'none', color: 'inherit' }}>
      <div className="im">
        {offer && <span className="tag">{pct}% OFF</span>}
        {p.image_url && (
          <img src={p.image_url} alt="" loading="lazy"
            style={{ objectPosition: `${p.image_focal_x ?? 50}% ${p.image_focal_y ?? 50}%`, opacity: p.is_available ? 1 : 0.45 }} />
        )}
        <span className="unit">{p.unit}</span>
        {p.is_available ? <AddButton product={p} /> : null}
      </div>
      <div className="sub">{p.category_name}</div>
      <div className="nm">{p.name}</div>
      {p.is_available ? (
        <div className="pr">
          {offer ? (<><s>{formatLkr(p.selling_price)}</s><span className="hl">{formatLkr(effectivePrice(p))}</span></>) : <span className="pl">{formatLkr(p.selling_price)}</span>}
        </div>
      ) : <div className="pr" style={{ color: 'var(--t3)' }}>Unavailable</div>}
      {offer && store?.show_offer_savings === true && <div className="sv">You save {formatLkr(savingsPerUnit(p))}</div>}
    </Link>
  );
}
