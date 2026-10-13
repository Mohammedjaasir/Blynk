import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getCategories, getProducts } from '../api/catalog';
import type { Category, Product } from '../api/types';
import { ApiError } from '../api/client';
import ProductCard from '../components/ProductCard';
import { goBack } from '../lib/goBack';
import ErrorState from '../components/ErrorState';
import { SkeletonRail } from '../components/Skeleton';
import rider from '../assets/rider.png';

export default function Aisle() {
  const { slug = '' } = useParams();
  const nav = useNavigate();
  const [state, setState] = useState<{ cat: Category | null; kids: Category[]; items: Product[] } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => {
    setError(null); setState(null);
    Promise.all([getCategories(), getProducts({ category_slug: slug, page: 1, limit: 100 })])
      .then(([{ categories }, { products }]) => {
        const cat = categories.find((c) => c.slug === slug) ?? null;
        setState({ cat, kids: cat ? categories.filter((c) => c.parent_id === cat.id) : [], items: products });
      })
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0)));
  };
  useEffect(load, [slug]);
  const back = () => goBack(nav);

  if (error) return <section className="screen"><ErrorState error={error} onRetry={load} /></section>;
  if (!state) return <section className="screen"><div className="sk" style={{ height: 146 }} /><SkeletonRail /></section>;
  if (!state.cat) return <section className="screen"><div style={{ padding: 40, textAlign: 'center' }}><h2>This aisle isn't available</h2><Link className="big" to="/" style={{ marginTop: 18, textDecoration: 'none' }}>Go to Shop</Link></div></section>;
  const c = state.cat;
  return (
    <section className="screen">
      <div className="sc">
        <div className="s-hero">{c.image_url && <img src={c.image_url} alt="" />}<button className="rb" style={{ left: 16 }} onClick={back} aria-label="Back">←</button></div>
        <div className="s-body">
          <h1>{c.name} at Blynk</h1>
          <div className="s-meta"><span>{state.items.length} items</span><span className="bar" /><span>8 AM – 9 PM</span></div>
          {c.offer_percent != null && (
            <div className="s-off"><div><div className="k">{c.offer_percent}% LOWER PRICES ON EVERYTHING HERE</div>{c.offer_ends_at && <div className="s">until {new Date(c.offer_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}</div></div>
          )}
          <Link to={`/search?c=${c.slug}`} className="ss" style={{ textDecoration: 'none' }}>Search in {c.name}</Link>
          {state.kids.length > 0 && <div className="fl" style={{ padding: '12px 0' }}>{state.kids.map((k) => <Link key={k.id} className="chip" to={`/aisle/${k.slug}`}>{k.name}</Link>)}</div>}
        </div>
        {state.items.length ? (
          <div className="grid">{state.items.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--t2)' }}><img src={rider} alt="" style={{ width: 150, margin: '0 auto' }} /><div style={{ fontSize: 17, fontWeight: 600, color: 'var(--t1)' }}>Coming soon to Blynk</div><div style={{ fontSize: 13.5 }}>We're stocking this aisle. Check back shortly.</div></div>
        )}
        <div style={{ height: 120 }} />
      </div>
    </section>
  );
}
