import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getProducts, getHomeGroups, getPromotions } from '../api/catalog';
import type { Product, Category, Promotion } from '../api/types';
import { ApiError } from '../api/client';
import { effectivePrice, isOfferActive } from '../lib/pricing';
import { startCatalogLive } from '../lib/catalogLive';
import ProductCard from '../components/ProductCard';
import CategoryTiles from '../components/CategoryTiles';
import PromoBanner from '../components/PromoBanner';
import { SkeletonRail } from '../components/Skeleton';
import ErrorState from '../components/ErrorState';

async function loadAll() {
  const first = await getProducts({ page: 1, limit: 100 });
  let products = first.products;
  for (let page = 2; page <= Math.min(first.pagination.total_pages, 20); page++) {
    products = products.concat((await getProducts({ page, limit: 100 })).products);
  }
  const [{ groups }, { promotions }] = await Promise.all([getHomeGroups(), getPromotions().catch(() => ({ promotions: [] as Promotion[] }))]);
  const categories: Category[] = groups.flatMap((g) => g.categories);
  return { products, categories, promotions };
}

export default function Home() {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadAll>> | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => { setError(null); loadAll().then(setData).catch((e) => setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0))); };
  useEffect(() => { load(); return startCatalogLive(() => { loadAll().then(setData).catch(() => {}); }); }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const avail = data.products.filter((p) => p.is_available);
    const offers = avail.filter((p) => isOfferActive(p));
    const pcts = new Set(offers.map((p) => Math.round((1 - effectivePrice(p) / p.selling_price) * 100)));
    return {
      offerHeading: pcts.size === 1 ? `${[...pcts][0]}% LOWER PRICES` : 'LOWER PRICES',
      under300: avail.filter((p) => effectivePrice(p) <= 300),
      offers,
      aisles: data.categories.map((c) => ({ c, items: data.products.filter((p) => p.category_id === c.id) })).filter((a) => a.items.length > 0),
      min: avail.length ? Math.min(...avail.map((p) => effectivePrice(p))) : null,
    };
  }, [data]);

  return (
    <section className="screen">
      <div className="sc">
        <div className="h-top">
          <div className="loc"><span className="pin" /><div className="grow"><div className="t">Dharga Town</div><div className="s">Groceries delivered within 4 km</div></div></div>
          <Link to="/search" className="search" style={{ textDecoration: 'none' }}>Search for 'Milk'</Link>
          <PromoBanner promotions={data?.promotions ?? []} products={data?.products ?? []} minPrice={view?.min ?? null} firstCategory={data?.categories[0]?.slug} />
        </div>
        <div className="stk">{data && <CategoryTiles categories={data.categories} products={data.products} />}</div>
        {error && <ErrorState error={error} onRetry={load} />}
        {!data && !error && <SkeletonRail />}
        {view && (
          <>
            {view.under300.length > 0 && (<><div className="stt fi"><h2>Under LKR 300</h2></div><div className="rail fi">{view.under300.map((p: Product) => <ProductCard key={p.id} product={p} />)}</div></>)}
            {view.offers.length > 0 && (<div className="band fi"><div className="K">{view.offerHeading}</div><div className="rail">{view.offers.map((p) => <ProductCard key={p.id} product={p} />)}</div></div>)}
            {view.aisles.length > 0 && <div className="stt"><h2 style={{ fontSize: 17 }}>Explore all aisles</h2></div>}
            {view.aisles.map(({ c, items }) => (
              <div className="aisle fi" key={c.id}>
                <div className="hd"><Link to={`/aisle/${c.slug}`} style={{ color: 'inherit', textDecoration: 'none' }}><h3>{c.name}</h3></Link><div className="m1">{items.length} items • 8 AM – 9 PM</div></div>
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
