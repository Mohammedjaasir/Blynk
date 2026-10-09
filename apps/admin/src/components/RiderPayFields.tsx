import { useEffect, useId, useState } from 'react';
import { settings as settingsApi } from '../api/resources';
import type { RiderPayType } from '../api/types';
import { PAY_TYPE_LABEL, formatPercent } from '../lib/riderPay';
import { Field } from './ui';

/**
 * Rider type (Company / Commission) as the site's segmented control, plus the
 * rider's own % for a commission rider (blank = the store default). Shared by
 * the approve dialog on Rider requests and "Change pay" on Rider earnings
 * (owner, 2026-10-09).
 */
export function RiderPayFields({
  payType,
  percent,
  defaultPercent,
  error,
  onPayType,
  onPercent,
}: {
  payType: RiderPayType;
  percent: string;
  defaultPercent: number | null;
  error?: string;
  onPayType(next: RiderPayType): void;
  onPercent(next: string): void;
}) {
  const labelId = useId();
  const defaultText = defaultPercent === null ? 'the store default' : `the default ${formatPercent(defaultPercent)}%`;
  return (
    <>
      <div className="field">
        <span className="field__label" id={labelId}>
          Rider type
        </span>
        <div className="segmented" role="group" aria-labelledby={labelId}>
          {(['COMPANY', 'COMMISSION'] as RiderPayType[]).map((option) => (
            <button
              key={option}
              type="button"
              className={option === payType ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={option === payType}
              onClick={() => onPayType(option)}
            >
              {PAY_TYPE_LABEL[option]}
            </button>
          ))}
        </div>
      </div>
      {payType === 'COMMISSION' ? (
        <Field
          label="Own commission (%)"
          hint={`Leave blank to use ${defaultText}. 0 to 100, up to 2 decimals.`}
          error={error}
        >
          <input
            className="input"
            inputMode="decimal"
            placeholder={defaultPercent === null ? undefined : formatPercent(defaultPercent)}
            value={percent}
            onChange={(e) => onPercent(e.target.value)}
          />
        </Field>
      ) : null}
      <p className="form__note">
        {payType === 'COMMISSION'
          ? 'Earns this share of the standard delivery fee on each delivery and keeps it out of the cash collected; hands in the rest.'
          : 'Salaried. No per-delivery commission; Blynk keeps the delivery charge and the rider hands in all cash collected.'}
      </p>
    </>
  );
}

/**
 * The store's default commission % for hints and labels; null until loaded
 * or when it cannot load (the pages still work, they just say "default").
 */
export function useDefaultCommission(): [number | null, (next: number) => void] {
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    settingsApi
      .getRiderCommission()
      .then((s) => live && typeof s?.default_percent === 'number' && setValue(s.default_percent))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return [value, setValue];
}
