import { Link } from 'react-router-dom';
import type { Category, Product } from '../api/types';
import { formatLkr } from '../lib/money';
import { effectivePrice } from '../lib/pricing';

export default function CategoryTiles({ categories, products, topOf = (id) => id }: { categories: Category[]; products: Product[]; topOf?: (id: string) => string }) {
  return (
    <div className="cats">
      {categories.map((c) => {
        const own = products.filter((p) => topOf(p.category_id) === c.id && p.is_available);
        const min = own.length ? Math.min(...own.map((p) => effectivePrice(p))) : null;
        return (
          <Link key={c.id} to={`/aisle/${c.slug}`} className="ct" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="im">
              {c.image_url && <img src={c.image_url} alt="" />}
              {min != null ? <span className="bd">FROM {formatLkr(min)}</span> : <span className="bd soon">SOON</span>}
            </div>
            <div className="nm">{c.name}</div>
          </Link>
        );
      })}
    </div>
  );
}
