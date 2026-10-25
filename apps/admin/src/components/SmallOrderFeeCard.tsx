import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { settings as settingsApi } from '../api/resources';
import type { CheckoutSettings } from '../api/types';
import { errorMessage, validationIssues } from '../lib/apiErrors';
import {
  SMALL_ORDER_NOT_READY_NOTICE,
  parseSmallOrderFeeAmount,
  parseSmallOrderMin,
  smallOrderFeeNeedsMigration,
  smallOrderFeeText,
  storedSmallOrderFee,
} from '../lib/smallOrderFee';
import { Switch } from './Switch';
import { Field, Spinner, useToast } from './ui';

/** The API's refusal while migration 063 has not been run by hand in Coolify. */
export const SMALL_ORDER_NOT_READY_MESSAGE = 'Run migration 063 in Coolify before switching the small-order fee on.';

/**
 * Settings -> Small-order fee (owner, 2026-10-25): `GET|PATCH /admin/settings/checkout` `small_order_fee`
 * `{ enabled, min_subtotal_lkr, fee_lkr }` (default off, LKR 1,000 / LKR 50). Customers whose item total
 * (after offers and bundle prices, before coupons and points) is UNDER the amount pay the fee on top of
 * delivery; free delivery does not remove it and rider pay is untouched. `small_order_fee_ready` is false
 * until migration 063 is run; switching on then answers 409 SMALL_ORDER_FEE_NOT_READY, shown inline.
 */
export function SmallOrderFeeCard() {
  const toast = useToast();
  const [current, setCurrent] = useState<CheckoutSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [minTotal, setMinTotal] = useState('1000');
  const [fee, setFee] = useState('50');
  const [minError, setMinError] = useState<string | undefined>();
  const [feeError, setFeeError] = useState<string | undefined>();
  const [saveError, setSaveError] = useState<string | null>(null);
  // Set when the API answered SMALL_ORDER_FEE_NOT_READY even though the GET did not say so.
  const [notReadyAnswer, setNotReadyAnswer] = useState(false);
  const [saving, setSaving] = useState(false);

  function show(setting: CheckoutSettings) {
    const stored = storedSmallOrderFee(setting);
    setCurrent(setting);
    setEnabled(stored.enabled);
    setMinTotal(String(Number(stored.min_subtotal_lkr.toFixed(2))));
    setFee(String(Number(stored.fee_lkr.toFixed(2))));
  }

  useEffect(() => {
    let cancelled = false;
    settingsApi
      .getCheckout()
      .then((setting) => !cancelled && show(setting))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the small-order fee.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const min = parseSmallOrderMin(minTotal);
    const amount = parseSmallOrderFeeAmount(fee);
    setMinError('error' in min ? min.error : undefined);
    setFeeError('error' in amount ? amount.error : undefined);
    if ('error' in min || 'error' in amount) return;
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await settingsApi.setCheckout({
        small_order_fee: { enabled, min_subtotal_lkr: min.value, fee_lkr: amount.value },
      });
      show(updated);
      setNotReadyAnswer(false);
      toast.success(`Small-order fee is ${smallOrderFeeText(storedSmallOrderFee(updated))}.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SMALL_ORDER_FEE_NOT_READY') {
        setNotReadyAnswer(true);
        setEnabled(false);
        setSaveError(err.message || SMALL_ORDER_NOT_READY_MESSAGE);
      } else {
        setSaveError(validationIssues(err)[0]?.message ?? errorMessage(err, 'Could not save the small-order fee.'));
      }
    } finally {
      setSaving(false);
    }
  }

  const needsMigration = smallOrderFeeNeedsMigration(current) || notReadyAnswer;

  return (
    <section className="panel" id="small-order-fee" aria-label="Small-order fee">
      <h2 className="panel__title">Small-order fee</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading the small-order fee" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <p className="panel__body">
            Currently {smallOrderFeeText(storedSmallOrderFee(current))}.
          </p>
          <p className="panel__body">
            <Switch checked={enabled} onChange={setEnabled} label="Charge a small-order fee" disabled={saving}>
              Charge a small-order fee ({enabled ? 'on' : 'off'})
            </Switch>
            {needsMigration ? (
              <span className="field__error" data-testid="small-order-fee-migration">
                {' '}
                {SMALL_ORDER_NOT_READY_NOTICE}
              </span>
            ) : null}
          </p>
          <Field label="Item total under (LKR)" hint="1 to 100,000, up to 2 decimals." error={minError}>
            <input className="input rp-num" inputMode="decimal" value={minTotal} onChange={(e) => setMinTotal(e.target.value)} />
          </Field>
          <Field label="Fee (LKR)" hint="0.01 to 1,000, up to 2 decimals." error={feeError}>
            <input className="input rp-num" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          </Field>
          {saveError ? (
            <p className="field__error" role="alert">
              {saveError}
            </p>
          ) : null}
          <p className="form__note">
            Customers whose items total less than this pay the fee on top of delivery. Free delivery does not remove it.
          </p>
          <p className="form__note">
            The item total is after item offers and bundle prices, before coupons and points. The rider is not affected:
            they still earn their share of the standard delivery fee. Changes apply to orders placed from now on.
          </p>
          <div className="form__actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Save'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
