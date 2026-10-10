import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { formatDay } from '../lib/riderDocuments';
import './rider-documents.css';

/**
 * The app's own date picker (owner, 2026-10-10: no plain native-looking
 * controls). A field-styled button that opens a small calendar: month and
 * year steps (a driving licence can expire years ahead), Today and Clear.
 * Works in YYYY-MM-DD only - the same calendar-date strings the API uses -
 * so no time zone ever shifts the picked day. Days before `min` are greyed
 * out and cannot be picked.
 */
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function monthOf(ymd: string | null | undefined, fallback: string): { y: number; m: number } {
  const [y, m] = (ymd || fallback).split('-').map(Number);
  return { y, m: m - 1 };
}

export function DatePicker({
  label,
  value,
  onChange,
  today,
  min,
  max,
  hint,
  error,
}: {
  label: string;
  value: string | null;
  onChange(next: string | null): void;
  /** Today's YYYY-MM-DD (Colombo) - where the calendar opens when empty. */
  today: string;
  min?: string;
  /** Days after `max` cannot be picked (rider pay adjustments, owner 2026-10-10). */
  max?: string;
  hint?: string;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(value, min && min > today ? min : today));
  const labelId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setView(monthOf(value, min && min > today ? min : today));
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Close only the calendar, not the screen it sits on.
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // Re-centre only when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function step(months: number) {
    setView(({ y, m }) => {
      const total = y * 12 + m + months;
      return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
    });
  }

  function pick(ymd: string | null) {
    onChange(ymd);
    setOpen(false);
  }

  // Monday-first grid with leading blanks.
  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const lead = (first + 6) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysIn(view.y, view.m) }, (_, i) => i + 1),
  ];

  return (
    <div className="field rdoc-date" ref={wrap}>
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        className={`input rdoc-date__button${value ? '' : ' is-empty'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-value`}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarDays size={18} aria-hidden="true" />
        <span id={`${labelId}-value`}>{value ? formatDay(value) : 'Pick a date'}</span>
      </button>
      {open ? (
        <div className="rdoc-cal" role="dialog" aria-label={`Pick ${label.toLowerCase()}`}>
          <div className="rdoc-cal__head">
            <button type="button" className="rdoc-cal__nav" aria-label="Previous year" onClick={() => step(-12)}>
              <ChevronsLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" className="rdoc-cal__nav" aria-label="Previous month" onClick={() => step(-1)}>
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <p className="rdoc-cal__title" aria-live="polite">
              {MONTH_NAMES[view.m]} {view.y}
            </p>
            <button type="button" className="rdoc-cal__nav" aria-label="Next month" onClick={() => step(1)}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <button type="button" className="rdoc-cal__nav" aria-label="Next year" onClick={() => step(12)}>
              <ChevronsRight size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="rdoc-cal__grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="rdoc-cal__weekday" aria-hidden="true">
                {w}
              </span>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <span key={`b${i}`} />;
              const ymd = ymdOf(view.y, view.m, day);
              const disabled = Boolean((min && ymd < min) || (max && ymd > max));
              const cls = [
                'rdoc-cal__day',
                ymd === value ? 'is-selected' : '',
                ymd === today ? 'is-today' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={ymd}
                  type="button"
                  className={cls}
                  disabled={disabled}
                  aria-pressed={ymd === value}
                  aria-label={formatDay(ymd)}
                  onClick={() => pick(ymd)}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="rdoc-cal__foot">
            <button type="button" className="text-button" onClick={() => setView(monthOf(today, today))}>
              This month
            </button>
            {value ? (
              <button type="button" className="text-button" onClick={() => pick(null)}>
                Clear
              </button>
            ) : null}
            <button type="button" className="button button--sm" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {hint && !error ? <span className="field__hint">{hint}</span> : null}
      {error ? <span className="field__error-text">{error}</span> : null}
    </div>
  );
}
