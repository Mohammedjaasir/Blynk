import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { orders as ordersApi } from '../api/resources';
import type { OrderDetail, OrderStatus } from '../api/types';
import { formatMoney } from '../lib/orders';
import { Field } from './ui';

/** Order states in which the API still lets staff make the delivery free. */
export const WAIVABLE_STATUSES: readonly OrderStatus[] = ['PLACED', 'ITEM_UNAVAILABLE', 'PACKED', 'OUT_FOR_DELIVERY'];
const MAX_REASON = 200;

type Waivable = Pick<OrderDetail, 'order_status' | 'payment_method' | 'payment_status' | 'delivery_fee'>;

/**
 * "Make delivery free" is offered (owner, 2026-10-21) on an open
 * cash-on-delivery order that still has a fee. An order paid online keeps
 * its total; its fee goes back through "Refund to wallet". The API decides
 * again under its lock. (Ported from Admin's OrderFreeDelivery - Ops is its
 * own implementation.)
 */
export function canWaiveDeliveryFee(order: Waivable): boolean {
  return (
    WAIVABLE_STATUSES.includes(order.order_status) &&
    order.payment_method === 'COD' &&
    order.payment_status !== 'PAID' &&
    Number(order.delivery_fee ?? 0) > 0
  );
}

/**
 * Order -> "Make delivery free": a confirm dialog with the current fee and
 * the new total (the cash the rider collects), an optional reason, then the
 * API. Once waived it says who did it and what the fee was. `onChanged`
 * re-reads the order so the bill shows the new total.
 */
export function OrderFreeDelivery({ order, onChanged }: { order: OrderDetail; onChanged(): void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(false);
    setReason('');
    setError(null);
  }, [order.id]);

  const waiver = order.delivery_fee_waiver ?? null;
  const allowed = canWaiveDeliveryFee(order);
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
      setOpen(false);
      setReason('');
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Nothing was changed.');
      // The order may have moved on (delivered, already free): close and show it as it is.
      if (err instanceof ApiError && err.status === 409) {
        setOpen(false);
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="order-detail__section" aria-label="Delivery fee">
      {waiver ? (
        <p className="order-detail__meta" data-testid="delivery-waived">
          Delivery made free{waiver.waived_by_name ? ` by ${waiver.waived_by_name}` : ' by staff'} (was{' '}
          {formatMoney(waiver.original_fee)}){waiver.reason ? ` - ${waiver.reason}` : ''}
        </p>
      ) : null}
      {error && !open ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {allowed ? (
        <button type="button" className="button button--ghost button--sm" onClick={() => setOpen(true)}>
          Make delivery free
        </button>
      ) : null}
      {open && allowed ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="free-delivery-title">
          <form className="modal__panel" onSubmit={submit} noValidate>
            <h2 className="modal__title" id="free-delivery-title">
              Make delivery free
            </h2>
            <p className="modal__message">
              Delivery fee now <span className="mono">{formatMoney(fee)}</span>. New total
              {order.payment_method === 'COD' ? ' (cash to collect)' : ''}:{' '}
              <strong className="mono" data-testid="free-delivery-new-total">
                {formatMoney(newTotal)}
              </strong>
              . The customer's app shows the new total; no text message is sent.
            </p>
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
            <div className="modal__actions">
              <button type="button" className="button button--ghost" disabled={saving} onClick={() => setOpen(false)}>
                Back
              </button>
              <button type="submit" className="button button--ink" disabled={saving}>
                {saving ? 'Saving…' : 'Make delivery free'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
