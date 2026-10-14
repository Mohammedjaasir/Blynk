/* Blynk Ops copy of apps/admin/src/components/HeroBannerPreview.tsx (common.md rule 2: no cross-app imports) - keep the two in step. */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { HERO_TIMING, heroSubSize, heroWaveSpan, heroWordSize, type HeroPreviewModel } from '../lib/heroBanner';
import { PhoneFrame, usePrefersReducedMotion } from './PhoneFrame';
import './heroBanner.css';

/*
 * The customer app's Home hero banner, live (docs/promo-surfaces.md §3): the same purple sky,
 * drifting clouds, saucer and beam lifting one illustrated item after another, the two words
 * jumping letter by letter, the rolling sub-line with its sweeping underline and firework, and
 * the ORDER NOW button - played with CSS at the app's timings inside a 390 pt phone screen.
 * Mirrors src/components/Banner.tsx in the customer app.
 */

const SCREEN_H = 520;
const P = HERO_TIMING.cycle;

export function HeroBannerPreview({ model, linkText }: { model: HeroPreviewModel; linkText?: string | null }) {
  const osReduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const [reducedPreview, setReducedPreview] = useState(false);
  const [replay, setReplay] = useState(0);
  const reduced = osReduced || reducedPreview;

  return (
    <div className="preview-panel">
      <PhoneFrame height={SCREEN_H} label="Home banner preview in the customer app">
        <div className="promo-motion hb-screen" data-paused={paused} data-reduced={reducedPreview} data-testid="hero-motion">
          <div className="hb-header" aria-hidden="true">
            <div className="hb-header__row">
              <span className="hb-header__pin" />
              <span>
                <strong>Dharga Town</strong>
                <em>Delivering to: Mosque Road, Dharga Town</em>
              </span>
            </div>
            <div className="hb-header__search">Search for &apos;Nadu Rice 5KG&apos;</div>
          </div>
          <HeroView key={replay} model={model} reduced={reduced} paused={paused} />
          <div className="mock-card" aria-hidden="true" style={{ marginTop: 14 }}>
            <p className="mock-title">Promotions</p>
            <div className="mock-line" style={{ width: '62%' }} />
            <div className="mock-line" style={{ width: '48%', marginTop: 8 }} />
          </div>
        </div>
      </PhoneFrame>
      <div className="preview-controls">
        <button type="button" className="button button--ghost button--sm" onClick={() => setPaused((p) => !p)}>
          {paused ? 'Play animation' : 'Pause animation'}
        </button>
        <button type="button" className="button button--ghost button--sm" onClick={() => setReplay((n) => n + 1)}>
          Replay
        </button>
        <label className="preview-note" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={reducedPreview} onChange={(e) => setReducedPreview(e.target.checked)} />
          Preview with "reduce motion"
        </label>
      </div>
      <p className="preview-note">
        {osReduced
          ? 'Your device asks for reduced motion, so the preview is still - customers with that setting see it still too.'
          : 'Animated exactly as the app plays it.'}{' '}
        {linkText ? `The button opens ${linkText}.` : 'The button scrolls down to the aisles (as today).'}
      </p>
    </div>
  );
}

/** Rolls between the sub-lines every 3.2 s (as the app). */
function useRoll(lines: string[], paused: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (lines.length < 2 || paused) return;
    const t = setInterval(() => setI((n) => n + 1), HERO_TIMING.roll);
    return () => clearInterval(t);
  }, [lines.length, paused]);
  return lines.length ? lines[i % lines.length]! : null;
}

/** The banner itself (exported for tests). */
export function HeroView({ model, reduced, paused }: { model: HeroPreviewModel; reduced: boolean; paused: boolean }) {
  const { items, title } = model;
  const [idx, setIdx] = useState(0);
  const line = useRoll(model.lines, paused);
  const many = items.length > 1;
  const itemsKey = items.join('');

  // One choreographed cycle per item: the next one drops in after 2.6 s (2.48 s with an exit).
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setIdx((i) => i + 1), many ? P - HERO_TIMING.next : P);
    return () => clearTimeout(t);
  }, [idx, many, paused]);
  useEffect(() => setIdx(0), [itemsKey]);

  const cur = items.length ? items[idx % items.length]! : null;
  const accent = model.accent;
  const parts = line && accent && line.includes(accent) ? line.split(accent) : null;
  const span = heroWaveSpan(title);
  const subSize = line ? heroSubSize(line, model.custom) : 15;
  const first = idx === 0;

  return (
    <div
      className="hb"
      data-testid="hero-banner"
      data-custom={model.custom}
      data-reduced={reduced}
      style={{ '--hb-wave': `${span * 1000}ms` } as CSSProperties}
    >
      <div className="hb-glow" />
      <div className="hb-clouds" aria-hidden="true">
        <svg width="420" height="60">
          <path d={CLOUD} fill="#250854" transform="translate(210 6) scale(1.1)" />
          <path d={CLOUD} fill="#250854" transform="translate(300 -2) scale(1.4)" opacity="0.9" />
          <path d={CLOUD} fill="#250854" transform="translate(372 14) scale(0.9)" />
        </svg>
      </div>
      {idx % 2 === 1 ? <span key={`m${idx}`} className="hb-moon" /> : null}
      <Sparkle x={168} y={150} delay={300} size={7} color="#fff" />
      <Sparkle x={214} y={30} delay={1200} size={6} color="#fff" />

      <div className="hb-copy">
        <WaveWord key={`a${idx}${title[0]}`} word={title[0]} color="#FFFFFF" offset={0} span={span} />
        <div style={{ marginTop: -5, marginLeft: -7 }}>
          <WaveWord key={`b${idx}${title[1]}`} word={title[1]} color="#FFE81F" offset={title[0].length + 0.6} span={span} clockO />
        </div>
        {line ? (
          <div className="hb-sub-wrap" style={model.custom ? { marginRight: -44 } : undefined}>
            <span className="hb-sub" data-testid="hero-line" style={subSize !== 15 ? { fontSize: subSize } : undefined}>
              {parts ? (
                <>
                  {parts[0]}
                  {accent}
                  {parts[1]}
                </>
              ) : (
                line
              )}
            </span>
            <span key={`u${idx}`} className="hb-underline" />
            {parts ? (
              <span key={`f${idx}`} className="hb-firework" aria-hidden="true">
                {FIREWORK.map((c, i) => (
                  <span key={i} className="hb-dash" style={{ background: c, '--a': `${(i * 360) / FIREWORK.length}deg` } as CSSProperties} />
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
        <span className="hb-cta" data-testid="hero-cta">
          <span className="hb-cta__slab" />
          <span className="hb-cta__pill">
            {model.cta}
            <span className="hb-cta__arrow">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="#1E0B3A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </span>
        </span>
      </div>

      <div className="hb-stage" aria-hidden="true">
        <div className="hb-beam">
          <div key={`bs${idx}`} className={many ? 'hb-beam__swing hb-beam__swing--on' : 'hb-beam__swing'}>
            <svg width="210" height="183">
              <defs>
                <linearGradient id="hbBeam" x1="0.8" y1="0" x2="0.35" y2="1">
                  <stop offset="0" stopColor="#FFE9A6" stopOpacity="1" />
                  <stop offset="0.45" stopColor="#F4C2D6" stopOpacity="0.62" />
                  <stop offset="1" stopColor="#C89DF0" stopOpacity="0.18" />
                </linearGradient>
                <linearGradient id="hbCore" x1="0.8" y1="0" x2="0.4" y2="1">
                  <stop offset="0" stopColor="#FFFBE6" stopOpacity="0.85" />
                  <stop offset="1" stopColor="#FFE9F4" stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points="138,44 172,50 206,183 40,183" fill="url(#hbBeam)" />
              <polygon points="148,46 166,49 170,150 108,150" fill="url(#hbCore)" />
            </svg>
          </div>
        </div>
        {cur ? (
          <div
            key={`i${idx}`}
            className={`hb-item${first ? '' : ' hb-item--drop'}${many ? ' hb-item--exit' : ''}`}
            data-testid="hero-item"
          >
            <span className="hb-item__bob">{cur}</span>
          </div>
        ) : null}
        <div className="hb-saucer">
          <div key={`s${idx}`} className={many ? 'hb-saucer__swing hb-saucer__swing--on' : 'hb-saucer__swing'}>
            <Saucer />
          </div>
        </div>
        <Sparkle x={150} y={104} delay={1500} size={12} />
        <Sparkle x={22} y={62} delay={800} size={9} />
        <Sparkle x={150} y={40} delay={2000} size={8} />
      </div>
    </div>
  );
}

const CLOUD = 'M0 18 C2 10 10 8 15 11 C17 4 27 2 31 8 C36 4 44 7 44 13 C50 13 52 18 50 20 L2 20 C0 20 0 19 0 18 Z';
const FIREWORK = ['#8FB8FF', '#FFFFFF', '#FF7ACB', '#8FB8FF', '#FFFFFF', '#FF7ACB', '#8FB8FF', '#FFFFFF', '#FF7ACB', '#FFFFFF'];

/** Letter-by-letter jump: a wave travels across the words once per cycle (~75 ms between neighbours). */
function WaveWord({ word, color, offset, span, clockO }: { word: string; color: string; offset: number; span: number; clockO?: boolean }) {
  const size = heroWordSize(word);
  const letters = useMemo(() => word.split(''), [word]);
  return (
    <div className="hb-word" style={{ fontSize: size, lineHeight: `${Math.round(size * 1.02)}px` }}>
      {letters.map((ch, i) => {
        const at = offset + i;
        // the app: bump while wave*12 - at*0.9 is in (0, 1); the wave runs at 1/1000 per ms
        const start = 1100 + (at * 0.9 * 1000) / 12;
        // letters past the wave's end (only after the next cycle starts) do not jump, as in the app
        const jumps = (at * 0.9 + 1) / 12 <= span + 1e-9;
        return (
          <span
            key={i}
            className={jumps ? 'hb-letter hb-letter--jump' : 'hb-letter'}
            style={
              {
                color,
                animationDelay: `${start}ms`,
                '--r': `${at % 2 ? 13 : -13}deg`,
              } as CSSProperties
            }
          >
            {ch === ' ' ? ' ' : ch}
            {clockO && ch === 'O' ? (
              <svg className="hb-clock" style={{ left: size * 0.3, top: size * 0.3 }} width={size * 0.36} height={size * 0.36} viewBox="0 0 12 12">
                <path d="M6 6 L6 2.2 M6 6 L8.8 7.6" stroke="#2E0C66" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/** Four-point star that blinks in, turns and goes out. */
function Sparkle({ x, y, delay, size, color = '#FFE81F' }: { x: number; y: number; delay: number; size: number; color?: string }) {
  return (
    <span className="hb-sparkle" style={{ left: x, top: y, animationDelay: `${delay}ms` }} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d="M12 0c1 7 5 11 12 12-7 1-11 5-12 12-1-7-5-11-12-12 7-1 11-5 12-12z" fill={color} />
      </svg>
    </span>
  );
}

/** The saucer: pink dome, thick pink rim, dark underside with a lime light ring. */
function Saucer() {
  return (
    <svg width="92" height="56" viewBox="0 0 92 56">
      <defs>
        <linearGradient id="hbDome" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8AD2" />
          <stop offset="0.55" stopColor="#F04FB2" />
          <stop offset="1" stopColor="#C41E86" />
        </linearGradient>
        <linearGradient id="hbLime" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F2FFB0" />
          <stop offset="1" stopColor="#8FC23A" />
        </linearGradient>
      </defs>
      <path d="M12 28 C12 7 30 1 47 1 C64 1 82 7 82 28 Z" fill="url(#hbDome)" />
      <path d="M26 13 C32 7 39 5 46 5" stroke="#fff" strokeOpacity="0.75" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <ellipse cx="46" cy="31" rx="43" ry="15" fill="#F04FB2" />
      <ellipse cx="46" cy="32.5" rx="36" ry="10.5" fill="#3A0B48" />
      <ellipse cx="46" cy="35" rx="20" ry="6" fill="url(#hbLime)" />
      <ellipse cx="46" cy="34" rx="11" ry="2.6" fill="#FBFFE0" opacity="0.9" />
    </svg>
  );
}
