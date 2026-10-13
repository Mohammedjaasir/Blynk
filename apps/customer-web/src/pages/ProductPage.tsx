import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getProduct } from '../api/catalog';
import type { Product } from '../api/types';
import { ApiError } from '../api/client';
import { formatLkr } from '../lib/money';
import { isOfferActive, effectivePrice } from '../lib/pricing';
import AddButton from '../components/AddButton';
import { goBack } from '../lib/goBack';
import ErrorState from '../components/ErrorState';

export default function ProductPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<Product | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const load = () => { setError(null); getProduct(id).then((r) => setP(r.product)).catch((e) => setError(e instanceof ApiError ? e : new ApiError('Something went wrong.', 0))); };
  useEffect(load, [id]);
  if (error?.status === 404) return <section className="screen"><div style={{ padding: 40, textAlign: 'center' }}><h2>Product no longer available</h2><button className="big" style={{ marginTop: 18 }} onClick={() => nav('/')}>Go to Shop</button></div></section>;
  if (error) return <section className="screen"><ErrorState error={error} onRetry={load} /></section>;
  if (!p) return <section className="screen"><div className="sk" style={{ height: 320, margin: 16 }} /></section>;
  const offer = isOfferActive(p);
  return (
    <section className="screen">
      <div className="sc">
        <div style={{ position: 'relative', background: 'linear-gradient(160deg,#F7F7F9,#ECEDF1)', height: 340 }}>
          <button className="rb" onClick={() => goBack(nav)} aria-label="Back" style={{ position: 'absolute', left: 16, top: 14 }}>←</button>
          {p.image_url && <img src={p.image_url} alt="" style={{ width: '70%', height: '80%', objectFit: 'contain', margin: '30px auto 0' }} />}
        </div>
        <div style={{ padding: '16px' }}>
          <div style={{ color: 'var(--t3)', fontSize: 13 }}>{p.category_name}</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{p.name}</h1>
          <div style={{ color: 'var(--t2)', fontSize: 14 }}>{p.unit}{p.pack_size ? ` · ${p.pack_size}` : ''}</div>
          <div className="pr" style={{ fontSize: 18, marginTop: 10 }}>
            {offer ? <><s>{formatLkr(p.selling_price)}</s><span className="hl">{formatLkr(effectivePrice(p))}</span></> : <span className="pl">{formatLkr(p.selling_price)}</span>}
          </div>
          {offer && p.offer_ends_at && <div style={{ fontSize: 13, color: 'var(--green)', marginTop: 4 }}>Offer ends {new Date(p.offer_ends_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600, color: p.is_available ? 'var(--green)' : 'var(--problem)' }}>{p.is_available ? 'Available' : 'Currently unavailable'}</div>
          {p.description && <><h2 style={{ fontSize: 16, marginTop: 18 }}>About this product</h2><p style={{ color: 'var(--t2)', fontSize: 14, marginTop: 6 }}>{p.description}</p></>}
        </div>
        <div style={{ height: 100 }} />
      </div>
      {p.is_available && (
        <div className="foot" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', width: 110, height: 40 }}><AddButton product={p} /></div>
          <Link to="/cart" className="big" style={{ textDecoration: 'none' }}>View cart</Link>
        </div>
      )}
    </section>
  );
}
