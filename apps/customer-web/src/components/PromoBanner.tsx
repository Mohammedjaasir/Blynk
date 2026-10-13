import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Product, Promotion } from '../api/types';
import { formatLkr } from '../lib/money';
import { useStore } from '../store/StoreContext';
import logoMark from '../assets/logo-mark.png';

interface Props { promotions: Promotion[]; products: Product[]; minPrice: number | null; firstCategory?: string }

export default function PromoBanner({ promotions, products, minPrice, firstCategory }: Props) {
  const store = useStore();
  const nav = useNavigate();
  const images = products.map((p) => p.image_url).filter((u): u is string => !!u).slice(0, 5);
  const [i, setI] = useState(0);
  const count = images.length;
  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setI((n) => n + 1), 2800);
    return () => clearInterval(t);
  }, [count]);

  const promo = promotions.find((p) => p.image_url);
  if (promo) {
    return <img className="banner-img" src={promo.image_url!} alt={promo.title ?? 'Offer'} style={{ display: 'block', width: 'calc(100% + 32px)', margin: '4px -16px 0', height: 180, objectFit: 'cover' }} />;
  }

  const headline = store?.new_customer_free_deliveries.enabled ? 'FREE DELIVERY' : 'FRESH GROCERIES';
  const [first, ...rest] = headline.split(' ');
  const to = firstCategory ? `/aisle/${firstCategory}` : '/';
  return (
    <div className="banner" role="link" tabIndex={0} onClick={() => nav(to)} onKeyDown={(e) => { if (e.key === 'Enter') nav(to); }}>
      <i className="st" style={{ left: 200, top: 14, width: 3, height: 3 }} /><i className="st" style={{ left: 350, top: 34, width: 3, height: 3, animationDelay: '.7s' }} /><i className="st" style={{ left: 178, top: 150, width: 2, height: 2, animationDelay: '1.2s' }} /><i className="st" style={{ left: 300, top: 166, width: 3, height: 3, animationDelay: '.3s' }} />
      <i className="sp" style={{ left: 214, top: 30 }} /><i className="sp" style={{ left: 362, top: 92, animationDelay: '.8s' }} /><i className="sp" style={{ left: 186, top: 112, animationDelay: '1.3s' }} />
      <div className="b-copy">
        <div className="b-h"><span>{first}</span><span className="y">{rest.join(' ')}</span></div>
        {minPrice != null && <div className="b-sub">Groceries starting at <b>{formatLkr(minPrice)}</b></div>}
        <Link to={to} className="b-cta" onClick={(e) => e.stopPropagation()} style={{ textDecoration: 'none' }}>ORDER NOW <span aria-hidden="true">→</span></Link>
      </div>
      <div className="ufo-w">
        <div className="beam" />
        <div className="lift">{count > 0 && <img key={i} src={images[i % count]} alt="" />}</div>
        <svg className="ufo" viewBox="0 0 400 220" aria-hidden="true">
          <defs>
            <radialGradient id="dome" cx="40%" cy="30%" r="75%"><stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".35" stopColor="#CFEFFF" stopOpacity=".85" /><stop offset="1" stopColor="#5FA8D8" stopOpacity=".9" /></radialGradient>
            <linearGradient id="tp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFF3A6" /><stop offset=".45" stopColor="#FFE141" /><stop offset="1" stopColor="#D9B800" /></linearGradient>
            <linearGradient id="bt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E334F" /><stop offset="1" stopColor="#11131D" /></linearGradient>
            <radialGradient id="gl"><stop offset="0" stopColor="#fff" /><stop offset=".5" stopColor="#FFE141" /><stop offset="1" stopColor="#FFE141" stopOpacity="0" /></radialGradient>
          </defs>
          <ellipse cx="200" cy="150" rx="150" ry="36" fill="url(#bt)" /><ellipse cx="200" cy="124" rx="190" ry="48" fill="url(#tp)" /><ellipse cx="200" cy="116" rx="176" ry="34" fill="#FFF3A6" opacity=".55" />
          <path d="M118 112c4-52 40-84 82-84s78 32 82 84c-22 10-50 14-82 14s-60-4-82-14z" fill="url(#dome)" />
          <path d="M150 70c10-20 28-30 46-30" stroke="#fff" strokeWidth="7" strokeLinecap="round" fill="none" opacity=".85" />
          <g transform="translate(200 82)"><circle r="28" fill="#fff" /><image href={logoMark} x="-20" y="-24" width="40" height="48" /></g>
          <g><circle cx="52" cy="132" r="9" fill="url(#gl)" /><circle cx="104" cy="148" r="9" fill="url(#gl)" /><circle cx="160" cy="156" r="9" fill="url(#gl)" /><circle cx="240" cy="156" r="9" fill="url(#gl)" /><circle cx="296" cy="148" r="9" fill="url(#gl)" /><circle cx="348" cy="132" r="9" fill="url(#gl)" /></g>
          <ellipse cx="200" cy="172" rx="58" ry="12" fill="#FFE141" opacity=".9" />
        </svg>
      </div>
    </div>
  );
}
