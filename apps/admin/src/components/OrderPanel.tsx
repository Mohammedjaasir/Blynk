import { useEffect, useState } from 'react';
import { orders as ordersApi } from '../api/resources';
import type { BoardOrder, OrderDetail, OrderItemRow } from '../api/types';
import {
  ACTION_LABEL,
  STATUS_LABEL,
  allowedActions,
  canMarkItemUnavailable,
  formatClock,
  isPackableFromItems,
  formatMoney,
  orderErrorMessage,
  primaryAction,
  shortNumber,
  type OrderAction,
} from '../lib/orders';
import type { UserRole } from '../api/types';
import { scheduledLabel } from '../lib/schedule';
import { Spinner } from './ui';
import { OrderBill } from './OrderBill';
import { OrderItems } from './OrderItems';

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
  onMarkItemUnavailable,
  onClose,
}: {
  order: BoardOrder;
  role: UserRole | undefined;
  /** Bumped by the board after every change, so the panel re-reads. */
  version: number;
  busy: boolean;
  onAction(action: OrderAction): void;
  /** Asks (with a confirmation) to mark one pending item unavailable. */
  onMarkItemUnavailable?(item: OrderItemRow): void;
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
  // Pack follows the same rule as the board (a substitution without a cost
  // blocks it), read from the detail's items when they are loaded - the
  // fresher of the two - and from the board's summary until then.
  const packableFromItems = detail && detail.id === order.id ? isPackableFromItems(detail.items) : null;
  const packEnabled =
    packableFromItems === null ? primary === 'pack' : actions.includes('pack') && packableFromItems;

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
      {/* The booked delivery slot (owner, 2026-10-10). */}
      {(detail?.scheduled_for ?? order.scheduled_for) ? (
        <p className="order-panel__scheduled ticket__scheduled">
          {detail?.scheduled_for
            ? scheduledLabel(detail.scheduled_for, detail.scheduled_until)
            : scheduledLabel(order.scheduled_for!, order.scheduled_until)}
        </p>
      ) : null}
      {!detail && !error ? <Spinner label="Loading the order" /> : null}

      {detail ? (
        <>
          <section className="order-panel__section" aria-label="Items">
            <h3 className="order-panel__label">Items</h3>
            <OrderItems
              items={detail.items}
              combos={detail.combos}
              renderAction={(item) =>
                onMarkItemUnavailable && canMarkItemUnavailable(order.order_status, item.item_status, role) ? (
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    disabled={busy}
                    aria-label={`Mark ${item.product_name_snapshot} unavailable`}
                    onClick={() => onMarkItemUnavailable(item)}
                  >
                    Mark unavailable
                  </button>
                ) : null
              }
            />
            <OrderBill order={detail} />
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
            {detail.delivery_alternate_phone ? (
              <p>
                <span className="order-panel__meta">Additional phone </span>
                <a
                  className="link mono"
                  href={`tel:${detail.delivery_alternate_phone}`}
                  aria-label={`Call additional phone for ${detail.delivery_recipient_name}`}
                >
                  {detail.delivery_alternate_phone}
                </a>
              </p>
            ) : null}
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
              disabled={busy || (action === 'pack' && !packEnabled)}
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
