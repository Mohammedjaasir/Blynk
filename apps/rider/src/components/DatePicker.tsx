import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Sheet } from './Sheet';

/**
 * The app's own date picker (owner, 2026-10-10: no plain native-looking
 * controls). A field-like button that opens a bottom sheet with a month
 * calendar; month and year steppers, because an expiry date is often a year
 * or more away. Values are 'YYYY-MM-DD' (no time, no time zone).
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** "31 Mar 2027" */
export function formatDay(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

export function todayIso(now = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

export function DatePicker({
  label,
  value,
  onChange,
  placeholder = 'Choose a date',
  disabled = false,
  hint,
}: {
  label: string;
  value: string | null;
  onChange(value: string | null): void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="datefield">
      <span className="field__label">{label}</span>
      <button
        type="button"
        className={`datefield__button${value ? '' : ' datefield__button--empty'}`}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`${label}: ${value ? formatDay(value) : placeholder}`}
      >
        <CalendarDays aria-hidden="true" size={22} />
        <span>{value ? formatDay(value) : placeholder}</span>
      </button>
      {hint ? <span className="datefield__hint">{hint}</span> : null}
      {open ? (
        <CalendarSheet
          title={label}
          value={value}
          onClose={() => setOpen(false)}
          onPick={(next) => {
            setOpen(false);
            onChange(next);
          }}
        />
      ) : null}
    </div>
  );
}

function CalendarSheet({
  title,
  value,
  onClose,
  onPick,
}: {
  title: string;
  value: string | null;
  onClose(): void;
  onPick(value: string | null): void;
}) {
  const start = value ?? todayIso();
  const [year, setYear] = useState(Number(start.slice(0, 4)));
  const [month, setMonth] = useState(Number(start.slice(5, 7)) - 1);
  const [picked, setPicked] = useState<string | null>(value);
  const today = todayIso();

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(year, month + 1, 0).getDate();
    return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  }, [year, month]);

  function step(months: number) {
    const total = year * 12 + month + months;
    setYear(Math.floor(total / 12));
    setMonth(((total % 12) + 12) % 12);
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="calendar">
        <div className="calendar__head">
          <button type="button" className="calendar__nav" onClick={() => step(-1)} aria-label="Previous month">
            <ChevronLeft aria-hidden="true" />
          </button>
          <span className="calendar__month" aria-live="polite">
            {MONTHS[month]} {year}
          </span>
          <button type="button" className="calendar__nav" onClick={() => step(1)} aria-label="Next month">
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
        <div className="calendar__years">
          <button type="button" className="calendar__year" onClick={() => step(-12)}>
            − 1 year
          </button>
          <button type="button" className="calendar__year" onClick={() => step(12)}>
            + 1 year
          </button>
        </div>
        <div className="calendar__grid" role="grid" aria-label={`${MONTHS[month]} ${year}`}>
          {WEEKDAYS.map((d) => (
            <span key={d} className="calendar__weekday" aria-hidden="true">
              {d}
            </span>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <span key={`blank-${i}`} />;
            const iso = toIso(year, month, day);
            const classes = ['calendar__day'];
            if (iso === picked) classes.push('calendar__day--on');
            if (iso === today) classes.push('calendar__day--today');
            return (
              <button
                key={iso}
                type="button"
                className={classes.join(' ')}
                aria-pressed={iso === picked}
                aria-label={formatDay(iso)}
                onClick={() => setPicked(iso)}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>
      <div className="sheet__actions">
        <button type="button" className="primary" disabled={!picked} onClick={() => onPick(picked)}>
          {picked ? `Use ${formatDay(picked)}` : 'Pick a day'}
        </button>
        {value ? (
          <button type="button" className="text-button" onClick={() => onPick(null)}>
            Clear the date
          </button>
        ) : null}
        <button type="button" className="text-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
