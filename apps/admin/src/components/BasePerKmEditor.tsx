import { basePerKmPreview, parseBaseFee, parseBaseKm, parsePerKmFee } from '../lib/deliveryFee';
import { formatTierLkr } from '../lib/kmTiers';
import { Field } from './ui';
import './kmTiers.css';

export interface BasePerKmDrafts {
  base: string;
  baseKm: string;
  perKm: string;
}

export interface BasePerKmErrors {
  base?: string;
  baseKm?: string;
  perKm?: string;
}

/**
 * "Base + per km" delivery fee fields (owner, 2026-10-25): a base fee that
 * covers the first km, then a fee for each extra STARTED km. Below the boxes a
 * live preview table (1.5, 2, 2.1, 3, 3.4, 4.8 and 5.6 km) computed by the same
 * formula the API uses (lib/deliveryFee.ts basePerKmFee), with the optional
 * maximum fee applied.
 */
export function BasePerKmEditor({
  drafts,
  onChange,
  errors,
  capLkr,
}: {
  drafts: BasePerKmDrafts;
  onChange(next: BasePerKmDrafts): void;
  errors?: BasePerKmErrors;
  capLkr?: number | null;
}) {
  const base = parseBaseFee(drafts.base);
  const baseKm = parseBaseKm(drafts.baseKm);
  const perKm = parsePerKmFee(drafts.perKm);
  const formula =
    'value' in base && 'value' in baseKm && 'value' in perKm
      ? { baseLkr: base.value, baseKm: baseKm.value, perKmLkr: perKm.value }
      : null;
  const rows = formula ? basePerKmPreview(formula, capLkr) : [];

  return (
    <div className="base-per-km">
      <Field label="Base fee (LKR)" hint="Between 0 and 1,000, up to 2 decimals." error={errors?.base}>
        <input
          className="input rp-num"
          inputMode="decimal"
          value={drafts.base}
          onChange={(e) => onChange({ ...drafts, base: e.target.value })}
        />
      </Field>
      <Field label="Covers the first (km)" hint="0.5 to 20 km, up to 1 decimal." error={errors?.baseKm}>
        <input
          className="input rp-num"
          inputMode="decimal"
          value={drafts.baseKm}
          onChange={(e) => onChange({ ...drafts, baseKm: e.target.value })}
        />
      </Field>
      <Field
        label="Then for each extra started km (LKR)"
        hint="Between 0 and 1,000, up to 2 decimals. 2.1 km with a 2 km base counts as 1 extra km."
        error={errors?.perKm}
      >
        <input
          className="input rp-num"
          inputMode="decimal"
          value={drafts.perKm}
          onChange={(e) => onChange({ ...drafts, perKm: e.target.value })}
        />
      </Field>
      <div className="kt-examples" aria-label="Fee preview" aria-live="polite" data-testid="base-per-km-preview">
        <span className="kt-examples__title">Preview</span>
        {formula ? (
          <table className="table" aria-label="Fee for example distances">
            <thead>
              <tr>
                <th scope="col">Distance</th>
                <th scope="col">Delivery fee</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.km}>
                  <td>{r.km} km</td>
                  <td className="mono">LKR {formatTierLkr(r.fee)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="kt-examples__empty">Enter all three amounts to see examples.</p>
        )}
      </div>
    </div>
  );
}
