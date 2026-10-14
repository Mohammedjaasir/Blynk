import { useEffect, useState } from 'react';
import riderUrl from '../assets/rider.png';
import { BAND_TIMING, type BandPreviewModel } from '../lib/promoBand';
import { PhoneFrame, usePrefersReducedMotion } from './PhoneFrame';

/*
 * The customer app's promo band, live (docs/promo-surfaces.md §1): the same
 * scalloped band, sliding headlines, light beam with the item dropping into
 * it and the waving / riding rider, played with CSS at the app's timings
 * inside a 390 pt phone screen. Mirrors src/components/PromoBand.tsx in the
 * customer app.
 */

const SCREEN_H = 470;

export function PromoBandPreview({ model, linkText }: { model: BandPreviewModel; linkText?: string | null }) {
  const osReduced = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  const [reducedPreview, setReducedPreview] = useState(false);
  const [replay, setReplay] = useState(0);
  const reduced = osReduced || reducedPreview;

  return (
    <div className="preview-panel">
      <PhoneFrame height={SCREEN_H} label="Promo band preview in the customer app">
        <div className="promo-motion" data-paused={paused} data-reduced={reducedPreview} data-testid="band-motion">
          <p className="mock-explore">Explore all aisles</p>
          <div className="mock-card" aria-hidden="true">
            <p className="mock-title">Groceries</p>
            <div className="mock-line" style={{ width: '62%' }} />
            <div className="mock-line" style={{ width: '48%', marginTop: 8 }} />
            <div className="mock-tiles">
              <div className="mock-tile" />
              <div className="mock-tile" />
              <div className="mock-tile" />
            </div>
          </div>
          <BandView key={replay} model={model} reduced={reduced} paused={paused} />
          <div className="mock-card" aria-hidden="true">
            <p className="mock-title">Household</p>
            <div className="mock-line" style={{ width: '55%' }} />
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
        {linkText ? `Tapping the band opens ${linkText}.` : 'The band is informational (no link).'}
      </p>
    </div>
  );
}

/** The band itself (exported for tests). */
export function BandView({ model, reduced, paused }: { model: BandPreviewModel; reduced: boolean; paused: boolean }) {
  const hasItem = model.item.kind !== 'NONE';
  const mascotOn = model.mascot !== 'OFF';
  const textW = Math.max(120, 390 - 36 - (mascotOn ? 84 : 0) - (hasItem ? 100 : 0));
  const perLine = Math.max(8, Math.floor((textW - 20) / 6.9));
  const rows = model.lines.some((l) => l.length > perLine) ? 2 : 1;
  const ink = model.colors.text;

  return (
    <div className="pb-band" data-testid="promo-band" data-mascot={model.mascot} data-item={model.item.kind}>
      <Scallop color={model.colors.start} />
      <div className="pb-body" style={{ background: `linear-gradient(${model.colors.start}, ${model.colors.end})` }}>
        {model.item.kind !== 'NONE' ? <Beam item={model.item} right={mascotOn ? 92 : 14} /> : null}
        {model.lines.length > 0 ? (
          <div className="pb-row pb-row--head" style={{ maxWidth: textW, marginBottom: model.ticks.length ? 9 : 0 }}>
            <Check color={ink} />
            <SlidingLines lines={model.lines} color={ink} rows={rows} reduced={reduced} paused={paused} />
          </div>
        ) : null}
        {model.ticks.length > 0 ? (
          <div className="pb-row pb-row--ticks" style={{ maxWidth: textW }}>
            {model.ticks.map((t) => (
              <span key={t} className="pb-tick">
                <Check color={ink} />
                <span className="pb-txt" style={{ color: ink }}>
                  {t}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {mascotOn ? (
          <span className={`pb-mascot pb-mascot--${model.mascot.toLowerCase()}`} data-testid="band-mascot">
            <img src={riderUrl} alt="" />
          </span>
        ) : null}
      </div>
      <Scallop color={model.colors.end} flip />
    </div>
  );
}

/** One headline at a time: it holds, slides up and out, and the next rises in. */
function SlidingLines({
  lines,
  color,
  rows,
  reduced,
  paused,
}: {
  lines: string[];
  color: string;
  rows: 1 | 2;
  reduced: boolean;
  paused: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const key = lines.join('\n');

  useEffect(() => {
    setIndex(0);
    setLeaving(false);
  }, [key]);

  useEffect(() => {
    if (lines.length < 2 || paused) return;
    let out: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      if (reduced) {
        setIndex((i) => i + 1);
        return;
      }
      setLeaving(true);
      out = setTimeout(() => {
        setIndex((i) => i + 1);
        setLeaving(false);
      }, BAND_TIMING.lineOut);
    }, BAND_TIMING.lineHold);
    return () => {
      clearInterval(timer);
      if (out) clearTimeout(out);
    };
  }, [key, lines.length, reduced, paused]);

  const current = lines[index % lines.length] ?? '';
  return (
    <div className="pb-lines" style={{ height: rows * 18 }} aria-live="off">
      <span
        key={index}
        data-testid="band-line"
        className={`pb-txt pb-line ${leaving ? 'pb-line--out' : index > 0 ? 'pb-line--in' : ''}`}
        style={{ color, WebkitLineClamp: rows }}
      >
        {current}
      </span>
    </div>
  );
}

function Beam({ item, right }: { item: Exclude<BandPreviewModel['item'], { kind: 'NONE' }>; right: number }) {
  return (
    <div className="pb-beam" style={{ right }} aria-hidden="true">
      <div className="pb-beam__glow">
        <svg viewBox="0 0 96 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id="pbBeamGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFFBE6" stopOpacity="0.95" />
              <stop offset="1" stopColor="#FFFBE6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points="31,0 65,0 96,100 0,100" fill="url(#pbBeamGrad)" />
        </svg>
      </div>
      <div className="pb-item" key={item.kind === 'IMAGE' ? item.uri : item.emoji} data-testid="band-item">
        <div className="pb-item__bob">
          {item.kind === 'IMAGE' ? <img src={item.uri} alt="" /> : <span className="pb-item__emoji">{item.emoji}</span>}
        </div>
      </div>
    </div>
  );
}

function Check({ color }: { color: string }) {
  return (
    <svg className="pb-check" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="4" stroke={color} strokeWidth="2" />
      <path d="M7 12.5l3.2 3.2L17 8.6" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The scalloped edge, 26 pt period, as the app draws it. */
function Scallop({ color, flip }: { color: string; flip?: boolean }) {
  let d = 'M0 10';
  for (let x = 0; x < 390; x += 26) d += ` Q${x + 6.5} 4 ${x + 13} 7 T${x + 26} 8`;
  d += ' L390 14 L0 14 Z';
  return (
    <svg className={flip ? 'pb-scallop pb-scallop--flip' : 'pb-scallop'} viewBox="0 0 390 14" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill={color} />
    </svg>
  );
}
