import { useId } from 'react';
import { EXAMPLE_KMS, MAX_KM_TIERS, MIN_KM_TIERS, tierExampleText, tiersOrNull, type TierErrors } from '../lib/kmTiers';
import './riderPay.css';
import './kmTiers.css';

/**
 * A two-way pick (owner, 2026-10-10) - "Same fee for every order" / "By
 * distance (per km)", "Base + per km" / "Per-km tiers" - as the site's
 * segmented control (no native radios).
 */
export function ModeChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(next: T): void;
}) {
  const id = useId();
  return (
    <div className="field kt-mode">
      <span className="field__label" id={id}>
        {label}
      </span>
      <div className="segmented segmented--wrap" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={o.value === value ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The per-km tier table (owner, 2026-10-10), shared by Settings -> Delivery
 * fee and rider distance pay: "km 1: LKR __", "km 2: LKR __", ... (1 to 10
 * rows), "+ Add km" / "Remove last km", the rule in plain words and a live
 * example ("3 km = LKR 100 + 60 + 50 = LKR 210"). The boxes stay text; the
 * parent parses them (lib/kmTiers parseTierDrafts) when saving.
 */
export function KmTierEditor({
  label,
  drafts,
  onChange,
  errors,
  capLkr = null,
  disabled = false,
}: {
  /** The group's name and visible heading, e.g. "Fee for each km". */
  label: string;
  drafts: string[];
  onChange(next: string[]): void;
  errors?: TierErrors;
  /** The delivery fee's maximum, for the examples; null = no cap. */
  capLkr?: number | null;
  disabled?: boolean;
}) {
  const labelId = useId();
  const tiers = tiersOrNull(drafts);
  const setRow = (i: number, value: string) => onChange(drafts.map((d, j) => (j === i ? value : d)));
  return (
    <div className="kt" role="group" aria-labelledby={labelId}>
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <ol className="kt-rows">
        {drafts.map((value, i) => (
          <li key={i} className="kt-row">
            <span className="kt-row__km">km {i + 1}</span>
            <span className="kt-money">
              <span className="kt-money__unit" aria-hidden="true">
                LKR
              </span>
              <input
                className="input"
                inputMode="decimal"
                aria-label={`km ${i + 1} (LKR)`}
                value={value}
                disabled={disabled}
                onChange={(e) => setRow(i, e.target.value)}
              />
            </span>
            {i === drafts.length - 1 ? <span className="kt-row__tag">and every km after</span> : null}
            {errors?.rows[i] ? <p className="rp-error">{`km ${i + 1}: ${errors.rows[i]}`}</p> : null}
          </li>
        ))}
      </ol>
      {errors?.list ? <p className="rp-error">{errors.list}</p> : null}
      <div className="kt-actions">
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={disabled || drafts.length >= MAX_KM_TIERS}
          // A new km starts at what that km pays now: the last row's amount.
          onClick={() => onChange([...drafts, drafts[drafts.length - 1] ?? ''])}
        >
          + Add km
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={disabled || drafts.length <= MIN_KM_TIERS}
          onClick={() => onChange(drafts.slice(0, -1))}
        >
          Remove last km
        </button>
      </div>
      <span className="field__hint">
        The last km's amount repeats for longer trips. Every started km counts: 2.3 km = km 1 + km 2 + km 3. Up to{' '}
        {MAX_KM_TIERS} rows.
      </span>
      <div className="kt-examples" aria-label="Examples" aria-live="polite" data-testid="km-tier-examples">
        <span className="kt-examples__title">Examples</span>
        {tiers ? (
          <ul>
            {EXAMPLE_KMS.map((km) => (
              <li key={km}>{tierExampleText(tiers, km, capLkr)}</li>
            ))}
          </ul>
        ) : (
          <p className="kt-examples__empty">Enter an amount for every km to see examples.</p>
        )}
      </div>
    </div>
  );
}
