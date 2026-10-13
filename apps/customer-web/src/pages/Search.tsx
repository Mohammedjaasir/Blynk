import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getProducts } from '../api/catalog';
import type { Product } from '../api/types';
import ProductCard from '../components/ProductCard';

const KEY = 'blynk.web.recentSearches';
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.slice(0, 8) : []; } catch { return []; } };
const remember = (q: string) => { try { localStorage.setItem(KEY, JSON.stringify([q, ...readRecent().filter((r) => r !== q)].slice(0, 8))); } catch { /* blocked */ } };

export default function Search() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const cat = params.get('c') ?? undefined;
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ items: Product[]; total: number } | null>(null);
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes(null); return; }
    const t = setTimeout(() => {
      getProducts({ search: term, category_slug: cat, page: 1, limit: 40 })
        .then((r) => { setRes({ items: r.products, total: r.pagination.total }); remember(term); setRecent(readRecent()); })
        .catch(() => setRes({ items: [], total: 0 }));
    }, 350);
    return () => clearTimeout(t);
  }, [q, cat]);
  return (
    <section className="screen">
      <div className="row" style={{ display: 'flex', gap: 10, padding: '14px 16px' }}>
        <button onClick={() => nav(-1)} aria-label="Back">←</button>
        <input type="search" role="searchbox" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groceries & essentials" className="ss" style={{ flex: 1, border: 0, outline: 0 }} />
      </div>
      <div className="sc">
        {!q.trim() && recent.length > 0 && (
          <div style={{ padding: '0 16px' }}>
            <div className="stt" style={{ padding: 0 }}><h2 style={{ fontSize: 16 }}>Recent searches</h2><button onClick={() => { localStorage.removeItem(KEY); setRecent([]); }}>Clear</button></div>
            <div className="fl" style={{ padding: '10px 0', flexWrap: 'wrap' }}>{recent.map((r) => <button key={r} className="chip" onClick={() => setQ(r)}>{r}</button>)}</div>
          </div>
        )}
        {res && res.total > 0 && <div style={{ padding: '4px 16px', color: 'var(--t2)', fontSize: 13 }}>{res.total === 1 ? '1 result' : `${res.total} results`}</div>}
        {res && res.total > 0 && <div className="grid">{res.items.map((p) => <ProductCard key={p.id} product={p} />)}</div>}
        {res && res.total === 0 && <div style={{ textAlign: 'center', padding: 40 }}><h2 style={{ fontSize: 17 }}>No results for "{q.trim()}"</h2><p style={{ color: 'var(--t2)', fontSize: 14, marginTop: 6 }}>Check the spelling or browse the aisles.</p><Link to="/" className="big" style={{ marginTop: 16, textDecoration: 'none' }}>Browse the shop</Link></div>}
      </div>
    </section>
  );
}
