import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { orders as ordersApi } from '../api/resources';
import type { BoardOrder } from '../api/types';
import { PageHeader } from '../components/Layout';
import { AssignRiderDialog, NoteDialog, needsNote } from '../components/OrderDialogs';
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

/**
 * The Orders board (plan §10), replacing F1's placeholder. Reuses Admin's
 * exact endpoints/lifecycle rules (`lib/orders.ts`, ported not imported -
 * common.md rule 2). Unlike Admin's Orders.tsx (a wide-screen board with a
 * slide-over detail panel), Operations is mobile-first (F1's bottom-tab
 * `Layout`, plan §8/§23/§24): tapping a row navigates to a full-page detail
 * route (`/orders/:id`, `pages/OrderDetail.tsx`) rather than opening a panel
 * beside the list - a single column reads better on a phone than a board
 * squeezed next to a fixed-width side panel would. Documented choice, not
 * required by the brief either way.
 */

/** How often the board re-reads while it is on screen (no push - the Rider/
 * Admin pattern). */
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

/** Asia/Colombo is UTC+05:30 all year (no daylight saving) - the same offset
 * trick Admin's own Orders.tsx and this app's own Home.tsx already use; a
 * fresh copy here too, not a shared import (common.md: never import from a
 * sibling app; within Operations, each page keeps its own small copy, the
 * pattern F2's Home.tsx already established). */
function startOfTodayColombo(now = new Date()): Date {
  const colombo = new Date(now.getTime() + 330 * 60_000);
  colombo.setUTCHours(0, 0, 0, 0);
  return new Date(colombo.getTime() - 330 * 60_000);
}

/**
 * F2's "Needs a look" Home links land here with `?focus=` (a nice-to-have
 * flagged, not required, by review-F2-report.md - "both 'needs a look' Home
 * links point at the same unfiltered /orders route; deep-link filtering is
 * F3's job"). This is a best-effort scroll-to-lane, not a true filter: the
 * board still always shows every live order (never hides real data behind a
 * link), it just brings the relevant lane into view once loaded.
 * `packing` is approximate - `needingPacking` (Home) covers both `PLACED`
 * and `ITEM_UNAVAILABLE`, but `laneOf` puts `ITEM_UNAVAILABLE` orders in
 * "Needs attention", not "To pack" - most newly-placed orders land in
 * "To pack", so that is the lane scrolled to.
 */
const FOCUS_LANE: Record<string, Lane> = { packing: 'toPack', readyForRider: 'readyForRider' };

export function Orders() {
  const [searchParams] = useSearchParams();
  const [live, setLive] = useState<BoardOrder[] | null>(null);
  const [closed, setClosed] = useState<BoardOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [dialog, setDialog] = useState<{ action: OrderAction; order: BoardOrder } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());
  const scrolledRef = useRef(false);

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

  // Deep-link scroll-into-view, once, after the board has real data.
  useEffect(() => {
    if (scrolledRef.current || !live) return;
    const focus = searchParams.get('focus');
    const lane = focus ? FOCUS_LANE[focus] : undefined;
    if (!lane) return;
    scrolledRef.current = true;
    document.getElementById(`lane-${lane}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [live, searchParams]);

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

  const delivered = closed.filter((o) => o.order_status === 'DELIVERED').length;
  const cancelled = closed.filter((o) => o.order_status === 'CANCELLED').length;

  return (
    <div className="page">
      <PageHeader
        title="Orders"
        description={loadedAt ? `Live orders, oldest first. Updated ${formatClock(loadedAt)}.` : 'Live orders, oldest first.'}
        actions={
          <button type="button" className="button button--ghost" onClick={() => void load()}>
            Refresh
          </button>
        }
      />

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {loadError ? (
        <p className="field__error" role="status">
          {loadError}
        </p>
      ) : null}
      {!live && !loadError ? (
        <p className="loading" role="status">
          Loading orders…
        </p>
      ) : null}
      {live && live.length === 0 ? <p className="orders__empty">No live orders.</p> : null}

      {LANES.map((lane) => {
        const rows = byLane.get(lane.id) ?? [];
        if (rows.length === 0) return null;
        const headingId = `lane-heading-${lane.id}`;
        return (
          <section key={lane.id} id={`lane-${lane.id}`} className={`lane lane--${lane.id}`} aria-labelledby={headingId}>
            <h2 className="lane__title" id={headingId}>
              {lane.title} <span className="lane__count">{rows.length}</span>
            </h2>
            <ul className="lane__rows">
              {rows.map((o) => (
                <OrderRow key={o.id} order={o} primary={primaryAction(o)} busy={busyId === o.id} onAct={(action) => act(o, action)} />
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

      {dialog?.action === 'assign' ? (
        <AssignRiderDialog
          order={dialog.order}
          busy={busyId === dialog.order.id}
          onClose={() => setDialog(null)}
          onAssign={(riderId, confirmFar) => void run(dialog.order, () => ordersApi.assignRider(dialog.order.id, riderId, confirmFar))}
        />
      ) : null}
      {dialog && needsNote(dialog.action) ? (
        <NoteDialog
          action={dialog.action}
          order={dialog.order}
          busy={busyId === dialog.order.id}
          onClose={() => setDialog(null)}
          onConfirm={(notes) => void run(dialog.order, () => ordersApi.setStatus(dialog.order.id, STATUS_FOR[dialog.action]!, notes))}
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
  onAct,
}: {
  order: BoardOrder;
  primary: OrderAction | null;
  busy: boolean;
  onAct(action: OrderAction): void;
}) {
  const number = shortNumber(order.order_number);
  const exception = laneOf(order) === 'attention';
  return (
    <li className={`ticket${exception ? ' ticket--exception' : ''}`}>
      <Link to={`/orders/${order.id}`} className="ticket__open" aria-label={`Open order #${number}`}>
        <span className="ticket__top">
          <span className="ticket__number mono">#{number}</span>
          {exception ? <span className="ticket__flag">{STATUS_LABEL[order.order_status]}</span> : null}
          <span className="ticket__age">{formatAge(order.placed_at)}</span>
        </span>
        <span className="ticket__where">
          <span className="ticket__place">{order.delivery_address_line1}</span>
          <span className="ticket__who">{order.delivery_recipient_name}</span>
        </span>
        <span className="ticket__foot">
          <span>{progress(order)}</span>
          {order.active_delivery?.rider_name ? <span className="ticket__rider">{order.active_delivery.rider_name}</span> : null}
          {order.scheduled_for ? <span className="ticket__scheduled">Scheduled {formatClock(order.scheduled_for)}</span> : null}
          <span className="ticket__total">{formatMoney(order.total_amount)}</span>
        </span>
      </Link>
      {primary ? (
        <div className="ticket__action">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => onAct(primary)}
            aria-label={`${ACTION_LABEL[primary]} #${number}`}
          >
            {busy ? 'Saving…' : ACTION_LABEL[primary]}
          </button>
        </div>
      ) : null}
    </li>
  );
}
