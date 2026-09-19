import { useEffect, useState } from 'react';
import { orders as ordersApi } from '../api/resources';
import type { BoardOrder, OrderDetail } from '../api/types';
import {
  ACTION_LABEL,
  ITEM_STATUS_LABEL,
  STATUS_LABEL,
  allowedActions,
  formatClock,
  formatMoney,
  orderErrorMessage,
  primaryAction,
  shortNumber,
  type OrderAction,
} from '../lib/orders';
import type { UserRole } from '../api/types';
import { Spinner } from './ui';

/** The Inventory app, where items are sourced (separate application). */
const INVENTORY_URL = (import.meta.env.VITE_INVENTORY_URL as string | undefined) ?? 'http://localhost:5174';

/**
 * One order, read-only apart from the actions this role may take in this
 * state. Items are shown by name, quantity and status only - costs and
 * suppliers belong to Inventory and are never rendered here.
 */
export function OrderPanel({
  order,
  role,
  version,
  busy,
  onAction,
  onClose,
}: {
  order: BoardOrder;
  role: UserRole | undefined;
  /** Bumped by the board after every change, so the panel re-reads. */
  version: number;
  busy: boolean;
  onAction(action: OrderAction): void;
  onClose(): void;
}) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const number = shortNumber(order.order_number);

  useEffect(() => {
    let cancelled = false;
    ordersApi
      .detail(order.id)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(orderErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [order.id, version]);

  const actions = allowedActions(order, role);
  const primary = primaryAction(order, role);
  const stillSourcing = order.order_status === 'PLACED' || order.order_status === 'ITEM_UNAVAILABLE';

  return (
    <aside className="order-panel" aria-label={`Order #${number}`}>
      <header className="order-panel__head">
        <div>
          <p className="order-panel__number mono">#{number}</p>
          <p className="order-panel__status">{STATUS_LABEL[order.order_status]}</p>
        </div>
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          Close
        </button>
      </header>

      {error ? <p className="ops-notice" role="status">{error}</p> : null}
      {!detail && !error ? <Spinner label="Loading the order" /> : null}

      {detail ? (
        <>
          <section className="order-panel__section" aria-label="Items">
            <h3 className="order-panel__label">Items</h3>
            <ul className="order-items">
              {detail.items.map((item) => (
                <li key={item.id} className={`order-items__row order-items__row--${item.item_status.toLowerCase()}`}>
                  <span className="order-items__qty mono">{item.quantity} ×</span>
                  <span className="order-items__name">{item.product_name_snapshot}</span>
                  <span className="order-items__status">{ITEM_STATUS_LABEL[item.item_status] ?? item.item_status}</span>
                </li>
              ))}
            </ul>
            {stillSourcing ? (
              <a className="link" href={`${INVENTORY_URL}/sourcing`} target="_blank" rel="noreferrer">
                Source items in Inventory →
              </a>
            ) : null}
          </section>

          <section className="order-panel__section" aria-label="Customer">
            <h3 className="order-panel__label">Customer</h3>
            <p className="order-panel__strong">{detail.delivery_recipient_name}</p>
            <a
              className="link mono"
              href={`tel:${detail.delivery_recipient_phone}`}
              aria-label={`Call ${detail.delivery_recipient_name}`}
            >
              {detail.delivery_recipient_phone}
            </a>
            <p>
              {detail.delivery_address_line1}
              {detail.delivery_address_line2 ? `, ${detail.delivery_address_line2}` : ''}, {detail.delivery_city}
            </p>
            {detail.delivery_instructions ? <p className="order-panel__note">“{detail.delivery_instructions}”</p> : null}
            <p className="order-panel__meta">
              {detail.payment_method === 'COD' ? 'Cash on delivery' : 'Paid online'} · {formatMoney(detail.total_amount)}
              {detail.payment_status === 'PAID' ? ' · paid' : ''}
            </p>
            {detail.cancellation_reason ? (
              <p className="order-panel__meta">Cancelled: {detail.cancellation_reason}</p>
            ) : null}
          </section>

          {detail.delivery ? (
            <section className="order-panel__section" aria-label="Rider">
              <h3 className="order-panel__label">Rider</h3>
              <p className="order-panel__strong">{detail.delivery.rider_name ?? 'Assigned rider'}</p>
            </section>
          ) : null}

          <section className="order-panel__section" aria-label="History">
            <h3 className="order-panel__label">History</h3>
            <ol className="order-history">
              {detail.history.map((h) => (
                <li key={h.id} className="order-history__row">
                  <span className="order-history__time mono">{formatClock(h.created_at)}</span>
                  <span className="order-history__status">{STATUS_LABEL[h.new_status] ?? h.new_status}</span>
                  {h.reason_or_notes && h.reason_or_notes.toLowerCase() !== (STATUS_LABEL[h.new_status] ?? '').toLowerCase() ? (
                    <span className="order-history__note">{h.reason_or_notes}</span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}

      {actions.length > 0 ? (
        <footer className="order-panel__actions">
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              className={
                action === primary
                  ? 'button'
                  : action === 'cancel'
                    ? 'button button--ink-outline'
                    : 'button button--ghost'
              }
              disabled={busy || (action === 'pack' && primary !== 'pack')}
              onClick={() => onAction(action)}
            >
              {ACTION_LABEL[action]}
            </button>
          ))}
        </footer>
      ) : null}
    </aside>
  );
}
