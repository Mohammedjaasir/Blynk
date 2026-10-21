import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { orders as ordersApi } from '../api/resources';
import type { OrderDetail, UserRole } from '../api/types';
import { formatMoney, type OrderStatus } from '../lib/orders';
import { Field, Spinner } from './ui';

/** Order states in which the API still lets staff make the delivery free. */
export const WAIVABLE_STATUSES: readonly OrderStatus[] = ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED', 'OUT_FOR_DELIVERY'];
const MAX_REASON = 200;

type Waivable = Pick<OrderDetail, 'order_status' | 'payment_method' | 'payment_status' | 'delivery_fee'>;

/**
 * "Make delivery free" is offered (owner, 2026-10-21) to Admin and
 * Operations, on an open cash-on-delivery order that still has a fee. An
 * order paid online keeps its total; its fee goes back through "Refund to
 * wallet". The API decides again under its lock.
 */
export function canWaiveDeliveryFee(order: Waivable, role: UserRole | undefined): boolean {
  return (
    (role === 'ADMIN' || role === 'OPERATIONS') &&
    WAIVABLE_STATUSES.includes(order.order_status) &&
    order.payment_method === 'COD' &&
    order.payment_status !== 'PAID' &&
    Number(order.delivery_fee ?? 0) > 0
  );
}

/**
 * Order -> "Make delivery free": a confirm step with the current fee and the
 * new total (what the rider collects), an optional reason, then the API.
 * Once waived it says who did it and what the fee was. `onChanged` re-reads
 * the order so the bill shows the new total.
 */
export function OrderFreeDelivery({
  order,
  role,
  onChanged,
}: {
  order: OrderDetail;
  role: UserRole | undefined;
  onChanged(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another order in the same panel starts closed.
  useEffect(() => {
    setConfirming(false);
    setReason('');
    setError(null);
  }, [order.id]);

  const waiver = order.delivery_fee_waiver ?? null;
  const allowed = canWaiveDeliveryFee(order, role);
  if (!waiver && !allowed && !error) return null;

  const fee = Number(order.delivery_fee ?? 0);
  // What the API will work out: a wallet or points payment never takes the total below 0.
  const newTotal = Math.max(0, Math.round((order.total_amount - fee) * 100) / 100);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await ordersApi.waiveDeliveryFee(order.id, reason.trim() || undefined);
      setConfirming(false);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Nothing was changed.');
      // The order may have moved on (delivered, already free): show it as it is.
      if (err instanceof ApiError && err.status === 409) onChanged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="free-delivery">
      {waiver ? (
        <p className="order-panel__meta" data-testid="delivery-waived">
          Delivery made free{waiver.waived_by_name ? ` by ${waiver.waived_by_name}` : ' by staff'} (was{' '}
          {formatMoney(waiver.original_fee)}){waiver.reason ? ` - ${waiver.reason}` : ''}
        </p>
      ) : null}
      {allowed && !confirming ? (
        <button type="button" className="button button--ghost button--sm" onClick={() => setConfirming(true)}>
          Make delivery free
        </button>
      ) : null}
      {allowed && confirming ? (
        <form className="form" onSubmit={submit} noValidate aria-label="Make delivery free">
          <dl className="pay-details">
            <dt>Delivery fee now</dt>
            <dd className="mono">{formatMoney(fee)}</dd>
            <dt>New total{order.payment_method === 'COD' ? ' (cash to collect)' : ''}</dt>
            <dd className="mono" data-testid="free-delivery-new-total">
              {formatMoney(newTotal)}
            </dd>
          </dl>
          <Field label="Reason (optional)" hint="For staff only - the customer just sees free delivery.">
            <input
              className="input"
              maxLength={MAX_REASON}
              placeholder="Late delivery last time"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form__actions">
            <button type="button" className="button button--ghost button--sm" disabled={saving} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="submit" className="button button--sm" disabled={saving}>
              {saving ? <Spinner label="Saving" /> : 'Make delivery free'}
            </button>
          </div>
        </form>
      ) : null}
      {error && !(allowed && confirming) ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
