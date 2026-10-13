import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getCategories, getHomeGroups, getPromotions } from '../api/catalog';
import type { Product, Category, Promotion } from '../api/types';
import { ApiError } from '../api/client';
import { effectivePrice, isOfferActive } from '../lib/pricing';
import { startCatalogLive } from '../lib/catalogLive';
import ProductCard from '../components/ProductCard';
import CategoryTiles from '../components/CategoryTiles';
import PromoBanner from '../components/PromoBanner';
import { SkeletonRail } from '../components/Skeleton';
import { loadAllProducts } from '../lib/loadAllProducts';
import SearchHint from '../components/SearchHint';
import ErrorState from '../components/ErrorState';
import { useCart } from '../cart/CartContext';
import { useStore } from '../store/StoreContext';
import { formatHours, radiusText } from '../lib/storeText';
import { topLevelOf } from '../lib/categories';

async function loadAll() {
  const products = await loadAllProducts();
  const [{ groups }, { promotions }, all] = await Promise.all([
    getHomeGroups(),
    getPromotions().catch(() => ({ promotions: [] as Promotion[] })),
    getCategories().then((r) => r.categories).catch(() => [] as Category[]),
  ]);
  const categories: Category[] = groups.flatMap((g) => g.categories);
  // Home groups list top-level categories only; products can sit in a child category, so roll them up.
  return { products, categories, promotions, topOf: topLevelOf(all.length ? all : categories) };
}

export default function Home() {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadAll>> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const cart = useCart();
  const store = useStore();
  const seq = useRef(0);
  const refresh = (onError?: (e: unknown) => void) => {
    const n = ++seq.current;
    loadAll().then((d) => {
      if (n !== seq.current) return; // a newer request is in flight; drop the stale answer
      setData(d);
      cart.reconcileWith(d.products); // keep cart prices and availability in step with the catalogue
    }).catch((e) => { if (n === seq.current) onError?.(e); });
  };
  const load = () => { setError(null); refresh((e) => setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0))); };
  useEffect(() => { load(); return startCatalogLive(() => refresh()); }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const avail = data.products.filter((p) => p.is_available);
    const offers = avail.filter((p) => isOfferActive(p));
    const pcts = new Set(offers.map((p) => Math.round((1 - effectivePrice(p) / p.selling_price) * 100)));
    const only = pcts.size === 1 ? [...pcts][0] : 0;
    return {
      offerHeading: only >= 1 ? `${only}% LOWER PRICES` : 'LOWER PRICES',
      under300: avail.filter((p) => effectivePrice(p) <= 300),
      offers,
      aisles: data.categories.map((c) => ({ c, items: data.products.filter((p) => data.topOf(p.category_id) === c.id) })).filter((a) => a.items.length > 0),
      min: avail.length ? Math.min(...avail.map((p) => effectivePrice(p))) : null,
    };
  }, [data]);

  return (
    <section className="screen">
      <div className="sc">
        <div className="h-top">
          <div className="loc"><span className="pin"><svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z" /></svg></span><div className="grow"><div className="t">Dharga Town</div>{radiusText(store) && <div className="s">{radiusText(store)}</div>}</div></div>
          <Link to="/search" className="search" style={{ textDecoration: 'none' }}><SearchHint names={(data?.products ?? []).slice(0, 6).map((p) => p.name)} /></Link>
          <PromoBanner promotions={data?.promotions ?? []} products={data?.products ?? []} minPrice={view?.min ?? null} firstCategory={data?.categories[0]?.slug} categories={data?.categories} />
        </div>
        <div className="stk">{data && <CategoryTiles categories={data.categories} products={data.products} topOf={data.topOf} />}</div>
        {error && <ErrorState error={error} onRetry={load} />}
        {!data && !error && <SkeletonRail />}
        {view && (
          <>
            {view.under300.length > 0 && (<><div className="stt fi"><h2>Under LKR 300</h2></div><div className="rail fi">{view.under300.map((p: Product) => <ProductCard key={p.id} product={p} />)}</div></>)}
            {view.offers.length > 0 && (<div className="band fi"><div className="K">{view.offerHeading}</div><div className="rail">{view.offers.map((p) => <ProductCard key={p.id} product={p} />)}</div></div>)}
            {view.aisles.length > 0 && <div className="stt"><h2 style={{ fontSize: 17 }}>Explore all aisles</h2></div>}
            {view.aisles.map(({ c, items }) => (
              <div className="aisle fi" key={c.id}>
                <div className="hd"><Link to={`/aisle/${c.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}><h3>{c.name}</h3></Link><div className="m1">{items.length} items{formatHours(store) ? ` • ${formatHours(store)}` : ''}</div></div>
                <div className="rail">{items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
              </div>
            ))}
            <div className="stt"><h2 style={{ fontSize: 17 }}>All products</h2></div>
            <div className="grid">{data!.products.map((p) => <ProductCard key={p.id} product={p} />)}</div>
            <div style={{ height: 120 }} />
          </>
        )}
      </div>
    </section>
  );
}
