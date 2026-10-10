import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIVE_ORDERS_LIMIT, LIVE_ORDERS_MAX_PAGES, orders as ordersApi } from '../api/resources';
import type { BoardOrder, OrderItemRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { AssignRiderDialog, MarkDeliveredDialog, NoteDialog, needsNote } from '../components/OrderDialogs';
import { OrderPanel } from '../components/OrderPanel';
import { ConfirmDialog, Spinner } from '../components/ui';
import {
  ACTION_LABEL,
  LANES,
  STATUS_LABEL,
  formatAge,
  formatClock,
  formatMoney,
  laneOf,
  orderErrorMessage,
  primaryAction,
  shortNumber,
  uncostedSubstitutions,
  type Lane,
  type OrderAction,
} from '../lib/orders';
import { scheduledLabel } from '../lib/schedule';

/** How often the board re-reads while it is on screen (no push; the Rider pattern). */
const REFRESH_MS = 20_000;

const STATUS_FOR: Partial<Record<OrderAction, string>> = {
  pack: 'PACKED',
  handOver: 'OUT_FOR_DELIVERY',
  markDelivered: 'DELIVERED',
  markFailed: 'FAILED',
  markCustomerUnavailable: 'CUSTOMER_UNAVAILABLE',
  restage: 'PACKED',
  cancel: 'CANCELLED',
};

function startOfTodayColombo(now = new Date()): Date {
  // Asia/Colombo is UTC+05:30 all year (no daylight saving).
  const colombo = new Date(now.getTime() + 330 * 60_000);
  colombo.setUTCHours(0, 0, 0, 0);
  return new Date(colombo.getTime() - 330 * 60_000);
}

/**
 * The store's live orders, grouped by the next thing that has to happen -
 * exceptions first, then packing, riders, and the road. Every step is a
 * request the API may refuse; the board says why and re-reads.
 */
export function Orders() {
  const { user } = useAuth();
  const role = user?.role;
  const [live, setLive] = useState<BoardOrder[] | null>(null);
  // Every live order the API has, which can be more than the page it returned.
  const [liveTotal, setLiveTotal] = useState(0);
  // True only when the board stopped at its page bound with orders unread.
  const [truncated, setTruncated] = useState(false);
  const [done, setDone] = useState({ delivered: 0, cancelled: 0 });
  const [pendingItem, setPendingItem] = useState<{ order: BoardOrder; item: OrderItemRow } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ action: OrderAction; order: BoardOrder } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // "Scheduled" filter (owner, 2026-10-10): only orders booked for a slot,
  // soonest slot first. "All" keeps the board's own order (oldest first).
  const [scheduledOnly, setScheduledOnly] = useState(false);
  const inFlight = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const since = startOfTodayColombo();
      const [liveOrders, delivered, cancelled] = await Promise.all([
        ordersApi.live(),
        ordersApi.countSince('DELIVERED', since),
        ordersApi.countSince('CANCELLED', since),
      ]);
      setLive(liveOrders.orders);
      setLiveTotal(liveOrders.total);
      setTruncated(liveOrders.truncated);
      setDone({ delivered, cancelled });
      setLoadError(null);
      setLoadedAt(new Date());
    } catch (err) {
      setLoadError(orderErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  /** One request per order at a time, whatever is clicked. */
  const run = useCallback(
    async (order: BoardOrder, step: () => Promise<unknown>) => {
      if (inFlight.current.has(order.id)) return;
      inFlight.current.add(order.id);
      setBusyId(order.id);
      setNotice(null);
      try {
        await step();
        setDialog(null);
        setPendingItem(null);
      } catch (err) {
        setNotice(orderErrorMessage(err));
        setDialog(null);
        setPendingItem(null);
      } finally {
        inFlight.current.delete(order.id);
        setBusyId(null);
        setVersion((v) => v + 1);
        await load();
      }
    },
    [load]
  );

  const act = useCallback(
    (order: BoardOrder, action: OrderAction) => {
      if (action === 'assign' || action === 'markDelivered' || needsNote(action)) {
        setDialog({ action, order });
        return;
      }
      void run(order, () => ordersApi.setStatus(order.id, STATUS_FOR[action]!));
    },
    [run]
  );

  const scheduledCount = useMemo(() => (live ?? []).filter((o) => o.scheduled_for).length, [live]);

  const byLane = useMemo(() => {
    const groups = new Map<Lane, BoardOrder[]>();
    const shown = scheduledOnly
      ? (live ?? [])
          .filter((o) => o.scheduled_for)
          .sort((a, b) => Date.parse(a.scheduled_for!) - Date.parse(b.scheduled_for!))
      : (live ?? []);
    for (const o of shown) {
      const lane = laneOf(o);
      groups.set(lane, [...(groups.get(lane) ?? []), o]);
    }
    return groups;
  }, [live, scheduledOnly]);

  const openOrder = live?.find((o) => o.id === openId) ?? null;
  const { delivered, cancelled } = done;

  return (
    <div className={`orders${openOrder ? ' orders--with-panel' : ''}`}>
      <div className="orders__main">
        <PageHeader
          title="Orders"
          description={
            loadedAt ? `Live orders, oldest first. Updated ${formatClock(loadedAt)}.` : 'Live orders, oldest first.'
          }
          actions={
            <button type="button" className="button button--ghost" onClick={() => void load()}>
              Refresh
            </button>
          }
        />

        {notice ? (
          <p className="ops-notice" role="status">
            {notice}
            <button type="button" className="ops-notice__dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </p>
        ) : null}
        {loadError ? (
          <p className="ops-notice" role="status">
            {loadError}
          </p>
        ) : null}
        {!live && !loadError ? <Spinner label="Loading orders" /> : null}
        {live && truncated && liveTotal > live.length ? (
          // The board reads every page up to its bound; never let the rest vanish silently.
          <p className="ops-notice" role="status">
            Showing {live.length} of {liveTotal} live orders — the board loads at most{' '}
            {(LIVE_ORDERS_LIMIT * LIVE_ORDERS_MAX_PAGES).toLocaleString('en-US')}. The oldest are shown first.
          </p>
        ) : null}
        {live && live.length === 0 ? <p className="orders__empty">No live orders.</p> : null}
        {live && live.length > 0 && (scheduledCount > 0 || scheduledOnly) ? (
          <div className="segmented orders-filter" role="group" aria-label="Show orders">
            <button
              type="button"
              className={!scheduledOnly ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={!scheduledOnly}
              onClick={() => setScheduledOnly(false)}
            >
              All
            </button>
            <button
              type="button"
              className={scheduledOnly ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={scheduledOnly}
              onClick={() => setScheduledOnly(true)}
            >
              Scheduled ({scheduledCount})
            </button>
          </div>
        ) : null}
        {live && scheduledOnly && scheduledCount === 0 ? (
          <p className="orders__empty">No scheduled orders.</p>
        ) : null}

        {LANES.map((lane) => {
          const rows = byLane.get(lane.id) ?? [];
          if (rows.length === 0) return null;
          const headingId = `lane-${lane.id}`;
          return (
            <section key={lane.id} className={`lane lane--${lane.id}`} aria-labelledby={headingId}>
              <h2 className="lane__title" id={headingId}>
                {lane.title} <span className="lane__count">{rows.length}</span>
              </h2>
              <ul className="lane__rows">
                {rows.map((o) => (
                  <OrderRow
                    key={o.id}
                    order={o}
                    primary={primaryAction(o, role)}
                    busy={busyId === o.id}
                    selected={openId === o.id}
                    onOpen={() => setOpenId(o.id)}
                    onAct={(action) => act(o, action)}
                  />
                ))}
              </ul>
            </section>
          );
        })}

        {delivered + cancelled > 0 ? (
          <section className="lane lane--done" aria-labelledby="lane-done">
            <h2 className="lane__title" id="lane-done">
              Done today
            </h2>
            <p className="lane__summary">
              {delivered} delivered · {cancelled} cancelled
            </p>
          </section>
        ) : null}
      </div>

      {openOrder ? (
        <OrderPanel
          order={openOrder}
          role={role}
          version={version}
          busy={busyId === openOrder.id}
          onAction={(action) => act(openOrder, action)}
          onMarkItemUnavailable={(item) => setPendingItem({ order: openOrder, item })}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {dialog?.action === 'assign' ? (
        <AssignRiderDialog
          order={dialog.order}
          busy={busyId === dialog.order.id}
          onClose={() => setDialog(null)}
          onAssign={(riderId, confirmFar) => void run(dialog.order, () => ordersApi.assignRider(dialog.order.id, riderId, confirmFar))}
        />
      ) : null}
      {dialog?.action === 'markDelivered' ? (
        <MarkDeliveredDialog
          order={dialog.order}
          busy={busyId === dialog.order.id}
          onClose={() => setDialog(null)}
          onConfirm={(proof) => void run(dialog.order, () => ordersApi.markDelivered(dialog.order.id, proof))}
        />
      ) : null}
      {pendingItem ? (
        <ConfirmDialog
          title="Mark item unavailable"
          message={`Mark ${pendingItem.item.quantity} × ${pendingItem.item.product_name_snapshot} unavailable on #${shortNumber(
            pendingItem.order.order_number
          )}? The customer is told, and it is left out of the bag and the bill. This cannot be undone here.`}
          confirmLabel="Mark unavailable"
          destructive
          onCancel={() => setPendingItem(null)}
          onConfirm={() =>
            void run(pendingItem.order, () => ordersApi.markItemUnavailable(pendingItem.order.id, pendingItem.item.id))
          }
        />
      ) : null}
      {dialog && needsNote(dialog.action) ? (
        <NoteDialog
          action={dialog.action}
          order={dialog.order}
          busy={busyId === dialog.order.id}
          onClose={() => setDialog(null)}
          onConfirm={(notes) =>
            void run(dialog.order, () => ordersApi.setStatus(dialog.order.id, STATUS_FOR[dialog.action]!, notes))
          }
        />
      ) : null}
    </div>
  );
}

function progress(o: BoardOrder): string {
  const s = o.items_summary;
  const toBag = s.total - s.unavailable;
  if (o.order_status === 'PLACED' || o.order_status === 'ITEM_UNAVAILABLE') {
    // No separate sourcing step: the pack takes every item off the shelf.
    const parts = [`${toBag} ${toBag === 1 ? 'item' : 'items'} to pack`];
    if (s.unavailable) parts.push(`${s.unavailable} unavailable`);
    return parts.join(' · ');
  }
  return `${toBag} ${toBag === 1 ? 'item' : 'items'}`;
}

function OrderRow({
  order,
  primary,
  busy,
  selected,
  onOpen,
  onAct,
}: {
  order: BoardOrder;
  primary: OrderAction | null;
  busy: boolean;
  selected: boolean;
  onOpen(): void;
  onAct(action: OrderAction): void;
}) {
  const number = shortNumber(order.order_number);
  const exception = laneOf(order) === 'attention';
  const blocked =
    (order.order_status === 'PLACED' || order.order_status === 'ITEM_UNAVAILABLE') &&
    primary === null &&
    uncostedSubstitutions(order.items_summary) > 0;
  return (
    <li className={`ticket${selected ? ' ticket--selected' : ''}${exception ? ' ticket--exception' : ''}`}>
      <button type="button" className="ticket__open" onClick={onOpen} aria-label={`Open order #${number}`}>
        <span className="ticket__number mono">#{number}</span>
        <span className="ticket__where">
          <span className="ticket__place">{order.delivery_address_line1}</span>
          <span className="ticket__who">{order.delivery_recipient_name}</span>
        </span>
        <span className="ticket__state">
          {exception ? <span className="ticket__flag">{STATUS_LABEL[order.order_status]}</span> : null}
          <span>{progress(order)}</span>
          {order.active_delivery?.rider_name ? <span className="ticket__rider">{order.active_delivery.rider_name}</span> : null}
          {order.scheduled_for ? (
            <span className="ticket__scheduled">{scheduledLabel(order.scheduled_for, order.scheduled_until)}</span>
          ) : null}
        </span>
        <span className="ticket__age">{formatAge(order.placed_at)}</span>
        <span className="ticket__total">{formatMoney(order.total_amount)}</span>
      </button>
      <span className="ticket__action">
        {primary ? (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => onAct(primary)}
            aria-label={`${ACTION_LABEL[primary]} #${number}`}
          >
            {busy ? 'Saving…' : ACTION_LABEL[primary]}
          </button>
        ) : blocked ? (
          <span className="ticket__hint">Substitution needs a cost</span>
        ) : null}
      </span>
    </li>
  );
}
