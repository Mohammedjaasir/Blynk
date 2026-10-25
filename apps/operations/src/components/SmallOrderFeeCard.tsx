import { useEffect, useState, type FormEvent } from 'react';
import { settings } from '../api/resources';
import type { CheckoutSettings } from '../api/types';
import { smallOrderFeeBody, smallOrderFeeOf, smallOrderFeeSummary } from '../lib/deliveryFee';
import { catalogErrorMessage } from '../lib/catalog';
import { formatDateTime } from '../lib/inventory';
import { Spinner } from './ui';

/**
 * Small-order fee (2026-10-25): `small_order_fee` in `GET|PATCH
 * /admin/settings/checkout`. Off by default. Customers whose item total
 * (after offers and bundle prices, before coupons) is under the amount pay
 * the fee on top of delivery; free delivery does not remove it and it never
 * touches rider pay. Switching it on before migration 063 has been run by
 * hand in Coolify is refused (409 SMALL_ORDER_FEE_NOT_READY): the server's
 * message is shown as the error.
 */
export function SmallOrderFeeCard() {
  const [current, setCurrent] = useState<CheckoutSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [min, setMin] = useState('');
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function show(s: CheckoutSettings) {
    const f = smallOrderFeeOf(s);
    setCurrent(s);
    setOn(f.enabled);
    setMin(String(f.min_subtotal_lkr));
    setFee(String(f.fee_lkr));
  }

  useEffect(() => {
    settings.checkout
      .get()
      .then(show)
      .catch((err) => setLoadError(catalogErrorMessage(err)));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const body = smallOrderFeeBody({ enabled: on, min, fee });
    if ('error' in body) {
      setError(body.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const saved = await settings.checkout.update(body);
      show(saved);
      const s = smallOrderFeeOf(saved);
      setNotice(s.enabled ? `Small-order fee is on. ${smallOrderFeeSummary(s)}` : 'Small-order fee is off.');
    } catch (err) {
      // 409 SMALL_ORDER_FEE_NOT_READY: the server's own message ("Run migration 063 in Coolify ...").
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const notReady = current?.small_order_fee_ready === false;

  return (
    <section className="card" id="small-order-fee" aria-labelledby="small-order-fee-title">
      <h2 className="section-label" id="small-order-fee-title">
        Small-order fee
      </h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !current ? (
        <Spinner label="Loading small-order fee" />
      ) : (
        <form className="form" onSubmit={save} noValidate>
          <label className="toggle">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
            <span>
              <strong>Charge a small-order fee</strong>
              <em>
                Customers whose items total less than this pay the fee on top of delivery. Free delivery does not remove it.
              </em>
            </span>
          </label>
          {notReady ? (
            <p className="quiet" data-testid="small-order-fee-not-ready">
              Needs migration 063
            </p>
          ) : null}
          <div className="field">
            <label className="field">
              <span className="field__label">Item total under (LKR)</span>
              <input
                className="input"
                inputMode="decimal"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </label>
            <span className="field__hint">LKR 1 to 100,000. After offers and bundle prices, before coupons and points.</span>
          </div>
          <div className="field">
            <label className="field">
              <span className="field__label">Fee (LKR)</span>
              <input
                className="input"
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </label>
            <span className="field__hint">LKR 0.01 to 1,000.</span>
          </div>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </form>
      )}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
      {notice ? <p className="quiet quiet--ok" role="status">{notice}</p> : null}
      {current?.updated_at ? <p className="quiet">Last changed {formatDateTime(current.updated_at)}</p> : null}
      <p className="page__note">
        It is not part of the delivery fee, so the rider is still paid their normal share of the delivery fee. Orders already placed
        keep what they were placed with.
      </p>
    </section>
  );
}
