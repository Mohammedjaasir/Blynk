import { useId } from 'react';
import { MAX_KM_TIERS, tierExampleText, tiersIfValid } from '../lib/kmTiers';
import './km-tiers.css';

/**
 * Per-km tier table editor (owner, 2026-10-10): "km 1: LKR __", "km 2: LKR
 * __", ... with add / remove-last (1..10 rows) and a live example worked out
 * with the same formula as the server. Used by the Delivery fee card (More)
 * and by rider distance pay (Rider pay page, Change pay, Approve). The app's
 * own styled rows and buttons - no native-looking controls.
 */
export function KmTierEditor({
  label,
  rows,
  onChange,
  rowErrors = [],
  cap = null,
  examples = [1, 3, 5],
  note,
  disabled = false,
}: {
  /** The group's visible label, e.g. "Price per km". */
  label: string;
  /** One LKR text per km row (km 1 first). */
  rows: string[];
  onChange(rows: string[]): void;
  /** A message per row that failed the last save check. */
  rowErrors?: (string | undefined)[];
  /** The delivery fee cap for the example (null = none; rider pay has none). */
  cap?: number | null;
  /** Trip lengths (km) for the live example. */
  examples?: number[];
  /** An extra hint line under the table. */
  note?: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  const tiers = tiersIfValid(rows);
  const setRow = (i: number, value: string) => onChange(rows.map((r, j) => (j === i ? value : r)));
  const last = rows.length;

  return (
    <div className="km-tiers" role="group" aria-labelledby={labelId}>
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <ol className="km-tiers__rows">
        {rows.map((value, i) => {
          const error = rowErrors[i];
          return (
            <li key={i} className={error ? 'km-tiers__row is-invalid' : 'km-tiers__row'}>
              <span className="km-tiers__km" aria-hidden="true">
                km {i + 1}
              </span>
              <span className="km-tiers__money">
                <span className="km-tiers__cur" aria-hidden="true">
                  LKR
                </span>
                <input
                  className="input km-tiers__input"
                  inputMode="decimal"
                  aria-label={`km ${i + 1} amount (LKR)`}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => setRow(i, e.target.value)}
                  aria-invalid={error ? true : undefined}
                />
              </span>
              {i === last - 1 && last > 0 ? <span className="km-tiers__repeat">and every km after</span> : null}
              {error ? <span className="field__error-text km-tiers__error">{error}</span> : null}
            </li>
          );
        })}
      </ol>
      <div className="km-tiers__actions">
        <button
          type="button"
          className="button button--sm button--ghost km-tiers__btn"
          disabled={disabled || last >= MAX_KM_TIERS}
          onClick={() => onChange([...rows, rows[last - 1] ?? ''])}
        >
          + Add km {last + 1 <= MAX_KM_TIERS ? last + 1 : ''}
        </button>
        <button
          type="button"
          className="button button--sm button--ghost km-tiers__btn"
          disabled={disabled || last <= 1}
          onClick={() => onChange(rows.slice(0, -1))}
        >
          Remove km {last}
        </button>
      </div>
      <span className="field__hint">
        The last km&apos;s amount repeats for longer trips. Every started km counts: 2.3 km = km 1 + km 2 + km 3. Up to{' '}
        {MAX_KM_TIERS} rows.
        {note ? ` ${note}` : ''}
      </span>
      <div className="km-tiers__example" data-testid="km-tier-example" aria-live="polite">
        <span className="km-tiers__example-title">Example</span>
        {tiers ? (
          examples.map((km) => (
            <span key={km} className="km-tiers__example-line mono">
              {tierExampleText(tiers, km, cap)}
            </span>
          ))
        ) : (
          <span className="km-tiers__example-line">Fill in every km to see an example.</span>
        )}
      </div>
    </div>
  );
}

/**
 * The "how is it priced" choice above the tier table (owner, 2026-10-10):
 * e.g. "Same fee for every order" / "By distance (per km)", or "Base + per
 * km" / "Per-km tiers". The app's segmented control, full width, wraps on a
 * phone.
 */
export function TierModeChoice<T extends string>({
  label,
  options,
  value,
  onPick,
  disabled = false,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; text: string }>;
  value: T;
  onPick(id: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented km-mode" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={o.id === value ? 'segmented__item is-selected' : 'segmented__item'}
          aria-pressed={o.id === value}
          disabled={disabled}
          onClick={() => onPick(o.id)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}
