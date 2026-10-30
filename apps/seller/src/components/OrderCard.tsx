import { useState } from 'react';
import { sellerApi } from '../api/resources';
import type { SellerOrder } from '../api/types';
import { lkr } from '../lib/format';
import {
  MIXED_MESSAGE,
  ORDER_STATUS_CHIP,
  READY_DONE_TEXT,
  itemLine,
  orderLabel,
  orderTime,
  readyErrorMessage,
} from '../lib/orders';
import { IconCheckCircle, IconClock, IconScooter } from './icons';
import { Sheet } from './Sheet';
import { Spinner } from './ui';

/**
 * One order. A NEW order of this seller alone has the big "Order is ready" button: it asks first
 * ("Tell the rider the order is ready for pick-up?"), then POST /seller/orders/:id/ready. The
 * API's refusals show on the card. No customer details anywhere: the seller sees what to pack.
 */
export function OrderCard({
  order,
  onChanged,
  onRefresh,
  now,
}: {
  order: SellerOrder;
  /** The server's newer copy of this order (after Ready). */
  onChanged(order: SellerOrder): void;
  /** Ask for the whole list again (an order moved on while the seller looked at it). */
  onRefresh(): void;
  now?: Date;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chip = ORDER_STATUS_CHIP[order.status];
  const label = orderLabel(order);

  async function markReady() {
    setBusy(true);
    setError(null);
    try {
      const next = await sellerApi.markOrderReady(order.id);
      // Whatever the answer carries, this order is now ready.
      onChanged({
        ...order,
        ...(next && typeof next === 'object' ? next : {}),
        status: 'READY',
        can_mark_ready: false,
        ready_at: next?.ready_at ?? new Date().toISOString(),
      });
      setAsking(false);
    } catch (err) {
      setAsking(false);
      setError(readyErrorMessage(err));
      // Another phone or Blynk staff may have moved the order: show where it is now.
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`ocard ocard--${order.status.toLowerCase().replace(/_/g, '-')}`} aria-label={`Order ${label}`}>
      <header className="ocard__head">
        <div className="ocard__titles">
          <h2 className="ocard__num">{label}</h2>
          <p className="muted ocard__time">{orderTime(order.placed_at, now)}</p>
        </div>
        <span className={`chip chip--${chip.tone}`}>
          <span className="chip__dot" aria-hidden="true" />
          {chip.label}
        </span>
      </header>

      <ul className="ocard__items">
        {order.items.map((item) => (
          <li key={`${item.product_id}-${item.name}`}>{itemLine(item)}</li>
        ))}
      </ul>

      {order.status !== 'CANCELLED' ? (
        <p className="ocard__earn">
          You earn <strong>{lkr(order.seller_amount)}</strong>
        </p>
      ) : null}

      {order.status === 'NEW' && order.can_mark_ready ? (
        <button
          type="button"
          className="button button--primary button--cta button--block ocard__ready"
          onClick={() => setAsking(true)}
        >
          <IconCheckCircle size={22} /> Order is ready
        </button>
      ) : null}
      {order.status === 'NEW' && !order.can_mark_ready ? (
        <p className="note note--wait ocard__note">
          <IconClock size={18} />
          <span>{MIXED_MESSAGE}</span>
        </p>
      ) : null}
      {order.status === 'READY' ? (
        <p className="note note--ok ocard__note" role="status">
          <IconCheckCircle size={18} />
          <span>{READY_DONE_TEXT}</span>
        </p>
      ) : null}
      {order.status === 'ON_THE_WAY' ? (
        <p className="note note--ok ocard__note">
          <IconScooter size={18} />
          <span>The rider has it and is on the way to the customer.</span>
        </p>
      ) : null}
      {order.status === 'CANCELLED' ? (
        <p className="note note--bad ocard__note">
          <span>This order was cancelled. No need to prepare it.</span>
        </p>
      ) : null}

      {error ? (
        <p className="field__error ocard__error" role="alert">
          {error}
        </p>
      ) : null}

      {asking ? (
        <Sheet
          eyebrow={label}
          title="Order is ready?"
          lede="Tell the rider the order is ready for pick-up?"
          onClose={() => setAsking(false)}
          busy={busy}
        >
          <div className="ocard__confirm">
            <button
              type="button"
              className="button button--primary button--cta button--block"
              disabled={busy}
              onClick={() => void markReady()}
              data-autofocus
            >
              {busy ? <Spinner label="Telling the rider" /> : null} Yes, tell the rider
            </button>
            <button type="button" className="button button--ghost button--block" disabled={busy} onClick={() => setAsking(false)}>
              Not yet
            </button>
          </div>
        </Sheet>
      ) : null}
    </article>
  );
}
