import type { RiderPayType } from '../api/types';
import { PAY_TYPE_OPTIONS, formatPercent } from '../lib/riderPay';

/**
 * Rider type picker (owner, 2026-10-09): Company or Commission, in the app's
 * own segmented control, and for Commission an optional own % - blank means
 * the store default, shown as the hint. Used when approving a rider request
 * and when changing a rider's pay.
 */
export function RiderPayFields({
  payType,
  onPayType,
  percent,
  onPercent,
  defaultPercent,
  error,
}: {
  payType: RiderPayType;
  onPayType(next: RiderPayType): void;
  percent: string;
  onPercent(next: string): void;
  /** The store default commission %, or null while unknown. */
  defaultPercent: number | null;
  error?: string | null;
}) {
  return (
    <div className="rider-pay">
      <div className="field">
        <span className="field__label" id="rider-pay-type-label">
          Rider type
        </span>
        <div className="segmented rider-pay__types" role="group" aria-labelledby="rider-pay-type-label">
          {PAY_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === payType ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={option.value === payType}
              onClick={() => onPayType(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="field__hint">
          {payType === 'COMPANY'
            ? 'Salaried. No commission per delivery; Blynk keeps the delivery charge.'
            : 'Earns a share of the standard delivery fee and keeps it from the cash they collect.'}
        </span>
      </div>
      {payType === 'COMMISSION' ? (
        <label className="field">
          <span className="field__label">Own commission % (optional)</span>
          <input
            className="input"
            inputMode="decimal"
            value={percent}
            placeholder={defaultPercent != null ? String(defaultPercent) : undefined}
            onChange={(e) => onPercent(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <span className="field__hint">
            {defaultPercent != null
              ? `Leave blank for the store default (${formatPercent(defaultPercent)}).`
              : 'Leave blank for the store default.'}
          </span>
          {error ? <span className="field__error-text">{error}</span> : null}
        </label>
      ) : null}
    </div>
  );
}
