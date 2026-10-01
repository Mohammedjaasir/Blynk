import { OrderBill } from '../components/OrderBill';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { orders as ordersApi } from '../api/resources';
import type { OrderDetail as OrderDetailData } from '../api/types';
import { AssignRiderDialog, MarkDeliveredDialog, NoteDialog, needsNote } from '../components/OrderDialogs';
import { deliveryCodeError } from '../lib/delivery';
import {
  ACTION_LABEL,
  ITEM_STATUS_LABEL,
  STATUS_LABEL,
  allowedActions,
  boardOrderLikeFromDetail,
  formatClock,
  formatMoney,
  orderErrorMessage,
  primaryAction,
  shortNumber,
  type OrderAction,
} from '../lib/orders';

const STATUS_FOR: Partial<Record<OrderAction, string>> = {
  pack: 'PACKED',
  handOver: 'OUT_FOR_DELIVERY',
  markDelivered: 'DELIVERED',
  markFailed: 'FAILED',
  markCustomerUnavailable: 'CUSTOMER_UNAVAILABLE',
  restage: 'PACKED',
  cancel: 'CANCELLED',
};

/**
 * One order, full page (plan §10). Operations' equivalent of Admin's
 * `OrderPanel` (ported, not imported - common.md rule 2), rendered as its
 * own route (`/orders/:id`, registered by F3 in App.tsx) rather than a
 * slide-over beside the board - see `pages/Orders.tsx`'s doc comment for
 * why. Read-only apart from the actions this order's current state allows;
 * items are shown by name, quantity and status only - costs and suppliers
 * stay in Inventory's domain (plan §10/§13), never rendered here.
 */
export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<OrderDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OrderAction | null>(null);
  // Per-action, not a single page-level flag (design-audit I7, matching
  // Orders.tsx's own per-order `busyId` pattern) - only the button actually
  // clicked relabels to "Saving…"; the others stay disabled but unchanged.
  const [busyAction, setBusyAction] = useState<OrderAction | null>(null);
  // A refused delivery code in "Mark delivered" - shown in the dialog, which stays open.
  const [codeError, setCodeError] = useState<{ message: string; locked: boolean } | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<OrderDetailData['items'][number] | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const d = await ordersApi.detail(id);
      setDetail(d);
      setError(null);
    } catch (err) {
      setError(orderErrorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: OrderAction, step: () => Promise<unknown>) => {
      setBusyAction(action);
      setNotice(null);
      try {
        await step();
        setDialog(null);
      } catch (err) {
        const refusedCode = action === 'markDelivered' ? deliveryCodeError(err) : null;
        if (refusedCode) {
          setCodeError(refusedCode);
          return;
        }
        setNotice(orderErrorMessage(err));
        setDialog(null);
      } finally {
        setBusyAction(null);
        await load();
      }
    },
    [load]
  );

  const act = useCallback(
    (action: OrderAction) => {
      if (!id) return;
      if (action === 'assign' || action === 'markDelivered' || needsNote(action)) {
        setCodeError(null);
        setDialog(action);
        return;
      }
      void run(action, () => ordersApi.setStatus(id, STATUS_FOR[action]!));
    },
    [id, run]
  );

  /** An item that is not on the shelf comes off the bill (the customer is told). */
  const markItemUnavailable = async (itemId: string) => {
    if (!id) return;
    setBusyItem(itemId);
    setNotice(null);
    try {
      await ordersApi.markItemUnavailable(id, itemId);
    } catch (err) {
      setNotice(orderErrorMessage(err));
    } finally {
      setBusyItem(null);
      setConfirmItem(null);
      await load();
    }
  };

  if (error && !detail) {
    return (
      <div className="page">
        <Link to="/orders" className="link">
          ← Back to Orders
        </Link>
        <p className="field__error">{error}</p>
        <button type="button" className="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="page">
        <Link to="/orders" className="link">
          ← Back to Orders
        </Link>
        <p className="loading" role="status">
          Loading the order…
        </p>
      </div>
    );
  }

  const boardLike = boardOrderLikeFromDetail(detail);
  const actions = allowedActions(boardLike);
  const primary = primaryAction(boardLike);
  const beingPacked = boardLike.order_status === 'PLACED' || boardLike.order_status === 'ITEM_UNAVAILABLE';
  const number = shortNumber(detail.order_number);

  return (
    <div className="page order-detail">
      <Link to="/orders" className="link">
        ← Back to Orders
      </Link>

      <header className="order-detail__head">
        <div>
          <p className="order-detail__number mono">#{number}</p>
          <p className="order-detail__status">{STATUS_LABEL[detail.order_status]}</p>
        </div>
        <Link className="button button--ghost button--sm" to={`/orders/${detail.id}/slip`}>
          Print packing slip
        </Link>
      </header>

      {notice ? (
        <p className="field__error" role="status">
          {notice}
        </p>
      ) : null}

      <section className="order-detail__section" aria-label="Items">
        <h2 className="order-detail__label">Items</h2>
        <ul className="order-items">
          {detail.items.map((item) => (
            <li key={item.id} className={`order-items__row order-items__row--${item.item_status.toLowerCase()}`}>
              <span className="order-items__qty mono">{item.quantity} ×</span>
              <span className="order-items__name">{item.product_name_snapshot}</span>
              <span className="order-items__status">{ITEM_STATUS_LABEL[item.item_status] ?? item.item_status}</span>
              {beingPacked && item.item_status === 'PENDING' ? (
                // Not on the shelf: off the bill, and the customer is told.
                <button
                  type="button"
                  className="text-button"
                  disabled={busyItem !== null || busyAction !== null}
                  onClick={() => setConfirmItem(item)}
                  aria-label={`Mark ${item.product_name_snapshot} unavailable`}
                >
                  {busyItem === item.id ? 'Saving…' : 'Unavailable'}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <OrderBill order={detail} />
      </section>

      <section className="order-detail__section" aria-label="Customer">
        <h2 className="order-detail__label">Customer</h2>
        <p className="order-detail__strong">{detail.delivery_recipient_name}</p>
        <a className="link mono" href={`tel:${detail.delivery_recipient_phone}`} aria-label={`Call ${detail.delivery_recipient_name}`}>
          {detail.delivery_recipient_phone}
        </a>
        <p>
          {detail.delivery_address_line1}
          {detail.delivery_address_line2 ? `, ${detail.delivery_address_line2}` : ''}, {detail.delivery_city}
        </p>
        {detail.delivery_instructions ? <p className="order-detail__note">"{detail.delivery_instructions}"</p> : null}
        <p className="order-detail__meta">
          {detail.payment_method === 'COD' ? 'Cash on delivery' : 'Paid online'} · {formatMoney(detail.total_amount)}
          {detail.payment_status === 'PAID' ? ' · paid' : ''}
        </p>
        {detail.cancellation_reason ? <p className="order-detail__meta">Cancelled: {detail.cancellation_reason}</p> : null}
      </section>

      {detail.delivery ? (
        <section className="order-detail__section" aria-label="Rider">
          <h2 className="order-detail__label">Rider</h2>
          <p className="order-detail__strong">{detail.delivery.rider_name ?? 'Assigned rider'}</p>
        </section>
      ) : null}

      <section className="order-detail__section" aria-label="History">
        <h2 className="order-detail__label">History</h2>
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

      {actions.length > 0 ? (
        <footer className="order-detail__actions">
          {actions.map((action) => (
            // Pack works straight from Placed: the pack itself takes every
            // item off the shelf (backend lifecycle PACK). The API still
            // refuses an order with nothing left to pack, or a product short
            // on stock, and the notice above says which.
            <button
              key={action}
              type="button"
              className={action === primary ? 'button' : action === 'cancel' ? 'button button--ink-outline' : 'button button--ghost'}
              disabled={busyAction !== null || busyItem !== null}
              onClick={() => act(action)}
            >
              {busyAction === action ? 'Saving…' : ACTION_LABEL[action]}
            </button>
          ))}
        </footer>
      ) : null}

      {dialog === 'assign' ? (
        <AssignRiderDialog
          order={detail}
          busy={busyAction === 'assign'}
          onClose={() => setDialog(null)}
          onAssign={(riderId, confirmFar) => void run('assign', () => ordersApi.assignRider(detail.id, riderId, confirmFar))}
        />
      ) : null}
      {confirmItem ? (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="item-unavailable-title">
          <div className="modal__panel">
            <h2 className="modal__title" id="item-unavailable-title">
              Mark item unavailable
            </h2>
            <p className="modal__message">
              {confirmItem.quantity} × {confirmItem.product_name_snapshot} comes off this order and its bill, and the
              customer is told. This cannot be undone.
            </p>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setConfirmItem(null)}>
                Back
              </button>
              <button
                type="button"
                className="button button--ink"
                disabled={busyItem !== null}
                onClick={() => void markItemUnavailable(confirmItem.id)}
              >
                {busyItem ? 'Saving…' : 'Mark unavailable'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {dialog === 'markDelivered' ? (
        <MarkDeliveredDialog
          order={detail}
          busy={busyAction === 'markDelivered'}
          error={codeError}
          onClose={() => setDialog(null)}
          onConfirm={(proof) => {
            setCodeError(null);
            void run('markDelivered', () => ordersApi.markDelivered(detail.id, proof));
          }}
        />
      ) : null}
      {dialog && needsNote(dialog) ? (
        <NoteDialog
          action={dialog}
          order={detail}
          busy={busyAction === dialog}
          onClose={() => setDialog(null)}
          onConfirm={(notes) => void run(dialog, () => ordersApi.setStatus(detail.id, STATUS_FOR[dialog]!, notes))}
        />
      ) : null}
    </div>
  );
}
