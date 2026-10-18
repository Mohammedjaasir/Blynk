/* Blynk Ops copy of apps/admin/src/components/PromoCarouselPreview.tsx (common.md rule 2: no cross-app imports) - keep the two in step. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Promotion } from '../api/types';
import { CAROUSEL, carouselOrder, slideLook, type SlideLook } from '../lib/promoCarousel';
import { PhoneFrame, usePrefersReducedMotion } from './PhoneFrame';

/*
 * The customer app's Home carousel, live (docs/promo-surfaces.md §2): the
 * 360 x 180 card in a 390 pt phone screen, 4 s per slide, a 450 ms push to
 * the next (carrying on forward after the last), the new slide's words,
 * picture and button easing in, dots, and no auto-advance under "reduce
 * motion". Mirrors src/components/PromoCarousel.tsx in the customer app.
 */

const SCREEN_H = 420;
const CARD_W = CAROUSEL.phoneWidth - CAROUSEL.gutter * 2;

export function PromoCarouselPreview({
  promotions,
  focusId,
  loopSingle = false,
  label = 'Carousel preview in the customer app',
}: {
  promotions: Promotion[];
  /** Start on (and come back to) this slide - the one being edited. */
  focusId?: string;
  /** With one slide, replay its arrival every cycle so its motion can be watched. */
  loopSingle?: boolean;
  label?: string;
}) {
  const slides = useMemo(() => carouselOrder(promotions).map((p) => ({ id: p.id, look: slideLook(p) })), [promotions]);
  const n = slides.length;
  const osReduced = usePrefersReducedMotion();
  const [reducedPreview, setReducedPreview] = useState(false);
  const reduced = osReduced || reducedPreview;
  const [playing, setPlaying] = useState(true);
  const [state, setState] = useState<{ idx: number; prev: number | null; dir: 1 | -1; tick: number }>({
    idx: 0,
    prev: null,
    dir: 1,
    tick: 0,
  });
  const clearPrev = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start on the slide being edited, and follow it when its order changes.
  const focusIndex = focusId ? slides.findIndex((s) => s.id === focusId) : -1;
  useEffect(() => {
    if (focusIndex >= 0) setState((s) => ({ ...s, idx: focusIndex, prev: null }));
  }, [focusIndex]);
  useEffect(() => {
    if (state.idx >= n && n > 0) setState((s) => ({ ...s, idx: 0, prev: null }));
  }, [n, state.idx]);

  const go = (to: number, dir: 1 | -1) => {
    if (n === 0) return;
    setState((s) => ({ idx: ((to % n) + n) % n, prev: reduced ? null : s.idx, dir, tick: s.tick + 1 }));
    if (clearPrev.current) clearTimeout(clearPrev.current);
    clearPrev.current = setTimeout(() => setState((s) => ({ ...s, prev: null })), CAROUSEL.change);
  };
  useEffect(() => () => {
    if (clearPrev.current) clearTimeout(clearPrev.current);
  }, []);

  const auto = playing && !reduced && (n > 1 || (loopSingle && n === 1));
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => go(state.idx + 1, 1), CAROUSEL.hold);
    return () => clearTimeout(t);
  }, [auto, state.idx, state.tick, n]);

  const cur = n ? slides[Math.min(state.idx, n - 1)]! : null;
  const old = state.prev != null && n > 0 ? slides[Math.min(state.prev, n - 1)] : undefined;
  const next = state.dir === 1 ? 'next' : 'prev';

  return (
    <div className="preview-panel">
      <PhoneFrame height={SCREEN_H} label={label}>
        <div className="promo-motion" data-paused={!playing} data-reduced={reducedPreview} data-testid="carousel-motion">
          <div className="mock-location" aria-hidden="true">
            <strong>Home</strong>
            <span>Dharga Town, Beruwala</span>
          </div>
          <div className="mock-search" aria-hidden="true">
            Search &quot;groceries&quot;
          </div>
          <div className="pc-card" style={{ width: CARD_W }} data-testid="carousel-card">
            {cur ? (
              <>
                {old ? (
                  <div key={`old-${state.tick}`} className={`pc-slide pc-slide--out-${next}`} aria-hidden="true">
                    <Slide look={old.look} />
                  </div>
                ) : null}
                <div
                  key={`cur-${state.tick}`}
                  className={`pc-slide ${old ? `pc-slide--in-${next}` : ''} ${state.tick > 0 || loopSingle ? 'pc-enter' : ''}`}
                  data-testid="carousel-slide"
                  aria-label={`Slide ${state.idx + 1} of ${n}: ${cur.look.title}`}
                  role="group"
                >
                  <Slide look={cur.look} />
                </div>
              </>
            ) : (
              <p className="preview-note" style={{ padding: 20 }}>
                No live promotions: the app hides the carousel.
              </p>
            )}
          </div>
          {n > 1 ? (
            <div className="pc-dots" role="tablist" aria-label="Slides">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  className="pc-dot"
                  aria-selected={i === state.idx}
                  aria-label={`Slide ${i + 1}: ${s.look.title}`}
                  onClick={() => i !== state.idx && go(i, i > state.idx ? 1 : -1)}
                />
              ))}
            </div>
          ) : null}
          <div className="mock-cats" aria-hidden="true">
            <div className="mock-cat" />
            <div className="mock-cat" />
            <div className="mock-cat" />
            <div className="mock-cat" />
          </div>
        </div>
      </PhoneFrame>
      <div className="preview-controls">
        <button
          type="button"
          className="button button--ghost button--sm"
          aria-label="Previous slide"
          disabled={n < 2}
          onClick={() => go(state.idx - 1, -1)}
        >
          ‹
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          aria-label="Next slide"
          disabled={n === 0}
          onClick={() => go(state.idx + 1, 1)}
        >
          ›
        </button>
        <label className="preview-note" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={reducedPreview} onChange={(e) => setReducedPreview(e.target.checked)} />
          Preview with "reduce motion"
        </label>
      </div>
      <p className="preview-note" aria-live="polite">
        {n === 0
          ? 'Nothing to show yet.'
          : reduced
            ? 'Reduce motion: the app does not move on by itself - customers swipe or tap the dots.'
            : n === 1 && !loopSingle
              ? 'One slide: it stays put, with no dots.'
              : `Slide ${state.idx + 1} of ${n} - each shows for ${CAROUSEL.hold / 1000} s, then the next slides in.`}
      </p>
    </div>
  );
}

/** One slide as the app draws it (exported for tests). */
export function Slide({ look }: { look: SlideLook }) {
  const bg = look.background;
  const bgStyle =
    bg.kind === 'solid'
      ? { background: bg.color }
      : bg.kind === 'gradient'
        ? { backgroundImage: `linear-gradient(135deg, ${bg.from}, ${bg.to})` }
        : {
            // Any size/shape fits without cropping, centred - .pc-card's own background (#f1f4f9)
            // shows through on the sides, same as the customer app's FocalImage.
            backgroundImage: `${bg.kind === 'image' ? `linear-gradient(${CAROUSEL.scrim}, ${CAROUSEL.scrim}), ` : ''}url(${bg.uri})`,
            backgroundSize: bg.kind === 'image' ? 'cover, contain' : 'contain',
            backgroundPosition: 'center',
          };
  return (
    <>
      <div className="pc-bg" style={bgStyle} data-background={bg.kind} />
      {look.foreground ? (
        <img className="pc-fg" src={look.foreground} alt="" style={{ maxWidth: CARD_W * 0.42 }} />
      ) : null}
      <div className="pc-safe" style={{ width: CARD_W * CAROUSEL.safeWidthPct }}>
        {look.showText ? (
          <div className="pc-text">
            <p className="pc-title" style={{ color: look.titleColor }}>
              {look.title}
            </p>
            {look.subtitle ? (
              <p className="pc-sub" style={{ color: look.subtitleColor }}>
                {look.subtitle}
              </p>
            ) : null}
          </div>
        ) : null}
        {look.cta ? (
          <span
            className={look.showText ? 'pc-cta' : 'pc-cta pc-cta--bottom'}
            style={{ background: look.ctaColors.bg, color: look.ctaColors.text }}
          >
            {look.cta}
          </span>
        ) : null}
      </div>
    </>
  );
}
