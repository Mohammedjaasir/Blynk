import { basePerKmPreview, parseBasePerKm } from '../lib/deliveryFee';
import { tierAmountText } from '../lib/kmTiers';
import './km-tiers.css';

/**
 * The "Base + per km" delivery fee fields (2026-10-25): the base fee, the km
 * it covers and the amount for each extra started km, with a live preview
 * table worked out by the same formula as the server (lib/deliveryFee.ts).
 */
export function BasePerKmFields({
  base,
  baseKm,
  perKm,
  onChange,
  cap = null,
  error,
  disabled = false,
}: {
  base: string;
  baseKm: string;
  perKm: string;
  onChange(next: { base: string; baseKm: string; perKm: string }): void;
  /** The optional maximum fee, for the preview (null = none). */
  cap?: number | null;
  /** The message from the last save check, shown red on the three fields. */
  error?: string | null;
  disabled?: boolean;
}) {
  const parsed = parseBasePerKm({ base, baseKm, perKm });
  const rows = 'value' in parsed ? basePerKmPreview(parsed.value, cap) : null;
  const invalid = error ? true : undefined;
  return (
    <div className="base-per-km">
      <label className="field">
        <span className="field__label">Base fee (LKR)</span>
        <input
          className="input"
          inputMode="decimal"
          value={base}
          onChange={(e) => onChange({ base: e.target.value, baseKm, perKm })}
          aria-invalid={invalid}
          disabled={disabled}
        />
      </label>
      <div className="field">
        <label className="field">
          <span className="field__label">Covers the first (km)</span>
          <input
            className="input"
            inputMode="decimal"
            value={baseKm}
            onChange={(e) => onChange({ base, baseKm: e.target.value, perKm })}
            aria-invalid={invalid}
            disabled={disabled}
          />
        </label>
        <span className="field__hint">0.5 to 20 km, at most 1 decimal.</span>
      </div>
      <div className="field">
        <label className="field">
          <span className="field__label">Then for each extra started km (LKR)</span>
          <input
            className="input"
            inputMode="decimal"
            value={perKm}
            onChange={(e) => onChange({ base, baseKm, perKm: e.target.value })}
            aria-invalid={invalid}
            disabled={disabled}
          />
        </label>
        <span className="field__hint">Every started km counts: 2.1 km with a 2 km base is 1 extra km.</span>
      </div>
      <div className="km-tiers__example" data-testid="base-per-km-preview" aria-live="polite">
        <span className="km-tiers__example-title">What customers pay</span>
        {rows ? (
          rows.map((r) => (
            <span key={r.km} className="km-tiers__example-line mono" data-testid={`base-per-km-row-${r.km}`}>
              {r.km} km = LKR {tierAmountText(r.fee)}
            </span>
          ))
        ) : (
          <span className="km-tiers__example-line">Fill in the three amounts to see an example.</span>
        )}
      </div>
    </div>
  );
}
