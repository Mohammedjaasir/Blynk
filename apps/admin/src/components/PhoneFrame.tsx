import { useEffect, useRef, useState, type ReactNode } from 'react';
import './promoSurfaces.css';

/** The customer app's design width (pt): previews draw at this size. */
export const PHONE_WIDTH = 390;
const BEZEL = 20; // 10 px each side

/**
 * A phone screen at the customer app's real size (390 x `height`), scaled
 * down only when the column is narrower, so what staff watch is what a
 * customer sees.
 */
export function PhoneFrame({ height, label, children }: { height: number; label: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, (w - BEZEL) / PHONE_WIDTH));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <figure ref={ref} className="phone-frame" aria-label={label}>
      <div
        className="phone-frame__viewport"
        style={{ width: PHONE_WIDTH * scale + BEZEL, height: height * scale + BEZEL }}
      >
        <div className="phone-frame__screen" style={{ width: PHONE_WIDTH, height, transform: `scale(${scale})` }}>
          <div className="phone-status" aria-hidden="true">
            <span>9:41</span>
            <span className="phone-status__dots">
              <span />
              <span />
            </span>
          </div>
          {children}
        </div>
      </div>
      <figcaption className="phone-frame__caption">
        {PHONE_WIDTH} x {height} pt, the app&apos;s real size{scale < 1 ? ` (shown at ${Math.round(scale * 100)}%)` : ''}
      </figcaption>
    </figure>
  );
}

/** The OS "reduce motion" setting, live. */
export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}
