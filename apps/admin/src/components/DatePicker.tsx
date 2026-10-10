import { useEffect, useId, useRef, useState } from 'react';
import { colomboDateKey } from '../lib/schedule';
import './riderDocuments.css';

/**
 * A styled date picker (owner, 2026-10-10: no plain native-looking
 * controls): a field-like button that opens a calendar popover. Values are
 * 'YYYY-MM-DD' calendar days, never shifted through a timezone. Month and
 * year steps make far-off expiry dates (licences run for years) quick to
 * reach. Escape closes the popover without closing whatever it sits in.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parseKey(key: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = key ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(key) : null;
  return match ? { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) } : null;
}

/** "15 October 2027" */
export function longDay(key: string): string {
  const p = parseKey(key);
  return p ? `${p.d} ${MONTHS[p.m]} ${p.y}` : key;
}

export function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'Pick a date',
  invalid = false,
  today = colomboDateKey(),
  max,
  markPast = true,
}: {
  value: string;
  onChange(next: string): void;
  /** Accessible name of the trigger, e.g. "Expiry date". */
  label: string;
  placeholder?: string;
  invalid?: boolean;
  /** 'YYYY-MM-DD'; days before it show in red (still pickable). */
  today?: string;
  /** 'YYYY-MM-DD'; later days cannot be picked (rider pay adjustments, owner 2026-10-10). */
  max?: string;
  /** false: past days look like any other day (a past day is normal, not a warning). */
  markPast?: boolean;
}) {
  const popId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const start = parseKey(value) ?? parseKey(today)!;
  const [view, setView] = useState({ y: start.y, m: start.m });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function toggle() {
    if (!open) {
      const at = parseKey(value) ?? parseKey(today)!;
      setView({ y: at.y, m: at.m });
    }
    setOpen((o) => !o);
  }

  const step = (months: number) =>
    setView((v) => {
      const total = v.y * 12 + v.m + months;
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
    });

  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7; // Monday first
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  function pick(key: string) {
    onChange(key);
    setOpen(false);
  }

  return (
    <div
      className="rd-date"
      ref={wrap}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className={`rd-date__trigger${value ? '' : ' is-empty'}`}
        aria-label={value ? `${label}: ${longDay(value)}` : label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-invalid={invalid || undefined}
        style={invalid ? { borderColor: 'var(--danger)' } : undefined}
        onClick={toggle}
      >
        <span>{value ? longDay(value) : placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="3" width="13" height="11.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div className="rd-date__pop" id={popId} role="dialog" aria-label={`${label} calendar`}>
          <div className="rd-date__head">
            <button type="button" className="rd-date__nav" aria-label="Previous year" onClick={() => step(-12)}>
              «
            </button>
            <button type="button" className="rd-date__nav" aria-label="Previous month" onClick={() => step(-1)}>
              ‹
            </button>
            <span className="rd-date__month" aria-live="polite">
              {MONTHS[view.m]} {view.y}
            </span>
            <button type="button" className="rd-date__nav" aria-label="Next month" onClick={() => step(1)}>
              ›
            </button>
            <button type="button" className="rd-date__nav" aria-label="Next year" onClick={() => step(12)}>
              »
            </button>
          </div>
          <div className="rd-date__grid" role="grid" aria-label={`${MONTHS[view.m]} ${view.y}`}>
            {DOW.map((d) => (
              <span key={d} className="rd-date__dow" aria-hidden="true">
                {d}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`blank-${i}`} />;
              const key = keyOf(view.y, view.m, day);
              const classes = ['rd-date__day'];
              if (key === value) classes.push('is-selected');
              if (key === today) classes.push('is-today');
              if (markPast && key < today) classes.push('is-past');
              const blocked = max !== undefined && key > max;
              return (
                <button
                  key={key}
                  type="button"
                  className={classes.join(' ')}
                  aria-label={longDay(key)}
                  aria-pressed={key === value}
                  disabled={blocked}
                  onClick={() => pick(key)}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="rd-date__foot">
            <button type="button" className="button button--ghost button--sm" onClick={() => pick(today)}>
              Today
            </button>
            {value ? (
              <button type="button" className="button button--ghost button--sm" onClick={() => pick('')}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
