import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { orders as ordersApi } from '../api/resources';
import type { BoardOrder } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { AssignRiderDialog, NoteDialog, needsNote } from '../components/OrderDialogs';
import { OrderPanel } from '../components/OrderPanel';
import { Spinner } from '../components/ui';
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
  type Lane,
  type OrderAction,
} from '../lib/orders';

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
  const [closed, setClosed] = useState<BoardOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ action: OrderAction; order: BoardOrder } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const inFlight = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const [liveOrders, closedToday] = await Promise.all([ordersApi.live(), ordersApi.closedSince(startOfTodayColombo())]);
      setLive(liveOrders);
      setClosed(closedToday);
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
      } catch (err) {
        setNotice(orderErrorMessage(err));
        setDialog(null);
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
      if (action === 'assign' || needsNote(action)) {
        setDialog({ action, order });
        return;
      }
      void run(order, () => ordersApi.setStatus(order.id, STATUS_FOR[action]!));
    },
    [run]
  );

  const byLane = useMemo(() => {
    const groups = new Map<Lane, BoardOrder[]>();
    for (const o of live ?? []) {
      const lane = laneOf(o);
      groups.set(lane, [...(groups.get(lane) ?? []), o]);
    }
    return groups;
  }, [live]);

  const openOrder = live?.find((o) => o.id === openId) ?? null;
  const delivered = closed.filter((o) => o.order_status === 'DELIVERED').length;
  const cancelled = closed.filter((o) => o.order_status === 'CANCELLED').length;

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
        {live && live.length === 0 ? <p className="orders__empty">No live orders.</p> : null}

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
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {dialog?.action === 'assign' ? (
        <AssignRiderDialog
          order={dialog.order}
          busy={busyId === dialog.order.id}
          onClose={() => setDialog(null)}
          onAssign={(riderId) => void run(dialog.order, () => ordersApi.assignRider(dialog.order.id, riderId))}
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
  const done = s.sourced + s.packed;
  if (o.order_status === 'PLACED' || o.order_status === 'ITEM_UNAVAILABLE') {
    const parts = [`${done} of ${toBag} sourced`];
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
  const waitingOnSourcing =
    (order.order_status === 'PLACED' || order.order_status === 'ITEM_UNAVAILABLE') && primary === null;
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
          {order.scheduled_for ? <span className="ticket__scheduled">Scheduled {formatClock(order.scheduled_for)}</span> : null}
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
        ) : waitingOnSourcing ? (
          <span className="ticket__hint">Source in Inventory</span>
        ) : null}
      </span>
    </li>
  );
}
