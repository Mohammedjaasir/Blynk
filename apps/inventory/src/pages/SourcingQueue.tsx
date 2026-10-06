import { useState } from 'react';
import { mapLimit } from '../lib/concurrency';
import { useAutoRefresh } from '../lib/autoRefresh';
import { sourcingApi, stockApi, suppliersApi } from '../api/resources';
import { ApiError } from '../api/client';
import type { OrderSourcing, QueueOrder, SourcingItem, StockRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/can';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, LoadError, Spinner, Status, type Tone, useToast } from '../components/ui';
import { errorMessage, isApiError } from '../lib/errors';
import { ITEM_STATUS_LABEL, ORDER_STATUS_LABEL, formatDateTime, formatMoney } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { SourceItemDialog } from './SourceItemDialog';

export interface QueueEntry {
  order: QueueOrder;
  sourcing: OrderSourcing;
}

export interface QueueData {
  entries: QueueEntry[];
  /** Open orders the backend has that this load did not read (beyond one page). */
  notLoaded: number;
}

/** Detail requests in flight at once while loading the queue. */
export const QUEUE_DETAIL_CONCURRENCY = 5;
/** How often the queue refreshes itself while the page is visible. */
export const QUEUE_REFRESH_MS = 30_000;

/**
 * Nothing left to buy and at least one item to put in the bag: every item is
 * sourced or unavailable, so the order can be packed.
 */
export const isReadyToPack = (sourcing: OrderSourcing) =>
  sourcing.metrics.pending_items === 0 && sourcing.items.some((i) => i.item_status === 'SOURCED');

/**
 * Open orders with items still to source, oldest first (first in, first
 * out), followed in the same order by those ready to pack. Details are read a
 * few at a time, never one request per order all at once.
 */
export async function loadQueue(): Promise<QueueData> {
  const { orders, total } = await sourcingApi.openOrders();
  const details = await mapLimit(orders, QUEUE_DETAIL_CONCURRENCY, (o) => sourcingApi.detail(o.id));
  const entries = orders
    .map((order, i) => ({ order, sourcing: details[i] }))
    .filter((entry) => entry.sourcing.metrics.pending_items > 0 || isReadyToPack(entry.sourcing))
    .sort((a, b) => a.order.placed_at.localeCompare(b.order.placed_at) || a.order.id.localeCompare(b.order.id));
  return { entries, notLoaded: Math.max(0, total - orders.length) };
}

const ITEM_TONE: Record<SourcingItem['item_status'], Tone> = {
  PENDING: 'warn',
  SOURCED: 'ok',
  PACKED: 'ok',
  UNAVAILABLE: 'bad',
  SUBSTITUTED: 'muted',
};

/**
 * Items waiting to be bought. Shows the order number and time only - the
 * customer's name, phone and address are not needed to source and are never
 * shown here.
 */
export function SourcingQueue() {
  const { user } = useAuth();
  const toast = useToast();
  const queue = useLoad(loadQueue, []);
  const stock = useLoad(() => stockApi.listAll({ include_inactive: true }), []);
  const suppliers = useLoad(() => suppliersApi.list(true), []);
  const [sourcing, setSourcing] = useState<{ order: QueueOrder; item: SourcingItem } | null>(null);
  const [unavailable, setUnavailable] = useState<{ order: QueueOrder; item: SourcingItem } | null>(null);
  const [unavailableBusy, setUnavailableBusy] = useState(false);
  const [unavailableError, setUnavailableError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [packing, setPacking] = useState<QueueEntry | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);

  const stockByProduct = new Map<string, StockRow>((stock.data?.inventory ?? []).map((r) => [r.product_id, r]));
  const entries = queue.data?.entries ?? [];
  const notLoaded = queue.data?.notLoaded ?? 0;
  const pendingItems = entries.reduce((sum, e) => sum + e.sourcing.metrics.pending_items, 0);
  const toSource = entries.filter((e) => e.sourcing.metrics.pending_items > 0).length;
  const readyToPack = entries.length - toSource;

  async function refresh() {
    await Promise.all([queue.reload(), stock.reload()]);
  }

  // Others source and pack at the same time; keep the list current without
  // a manual Refresh. Paused while a dialog is open so nothing shifts under it.
  useAutoRefresh(() => void refresh(), QUEUE_REFRESH_MS, Boolean(sourcing || unavailable || packing));

  async function confirmPacked() {
    if (!packing) return;
    setPackBusy(true);
    setPackError(null);
    try {
      await sourcingApi.markPacked(packing.order.id);
      toast.success(`${packing.order.order_number} marked packed.`);
      setPacking(null);
      await refresh();
    } catch (err) {
      // Stale order: someone packed or cancelled it first. Explain, refresh.
      if (err instanceof ApiError && (err.status === 409 || err.status === 422)) {
        setBanner(`${packing.order.order_number}: ${errorMessage(err)}`);
        setPacking(null);
        await refresh();
        return;
      }
      setPackError(errorMessage(err, 'The order was not marked packed.'));
    } finally {
      setPackBusy(false);
    }
  }

  async function confirmUnavailable() {
    if (!unavailable) return;
    setUnavailableBusy(true);
    setUnavailableError(null);
    try {
      await sourcingApi.markUnavailable(unavailable.order.id, unavailable.item.id);
      toast.success(
        `${unavailable.item.product_name_snapshot} removed from ${unavailable.order.order_number}. The customer will be notified.`
      );
      setUnavailable(null);
      await refresh();
    } catch (err) {
      // Backend is authoritative: someone else resolved or sourced the item
      // first. Same handling as a sourcing conflict - explain and refresh.
      if (isApiError(err, 'ITEM_ALREADY_RESOLVED') || isApiError(err, 'ITEM_ALREADY_SOURCED')) {
        const what = isApiError(err, 'ITEM_ALREADY_RESOLVED') ? 'resolved' : 'sourced';
        setBanner(
          `${unavailable.item.product_name_snapshot} on ${unavailable.order.order_number} was already ${what} by someone else. Showing the latest queue.`
        );
        setUnavailable(null);
        await refresh();
        return;
      }
      setUnavailableError(errorMessage(err, 'The item was not marked unavailable.'));
    } finally {
      setUnavailableBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Sourcing queue"
        description={
          queue.data
            ? entries.length
              ? `${toSource} ${toSource === 1 ? 'order' : 'orders'} · ${pendingItems} ${pendingItems === 1 ? 'item' : 'items'} to source, oldest first.${readyToPack ? ` ${readyToPack} ready to pack.` : ''}`
              : 'Nothing waiting.'
            : 'Open orders with items still to buy, oldest first.'
        }
        actions={
          <button type="button" className="button button--ghost" onClick={() => void refresh()} disabled={queue.loading}>
            {queue.loading ? <Spinner label="Refreshing" /> : 'Refresh'}
          </button>
        }
      />

      {banner ? (
        <div className="notice notice--warn" role="status">
          <span>{banner}</span>
          <button type="button" className="button button--ghost button--sm" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notLoaded > 0 ? (
        <div className="notice notice--warn" role="status">
          <span>
            Not every open order is shown: {notLoaded} more {notLoaded === 1 ? 'order was' : 'orders were'} not
            loaded. Work through these, then refresh.
          </span>
        </div>
      ) : null}
      {queue.error ? <LoadError error={queue.error} onRetry={() => void queue.reload()} /> : null}
      {queue.loading && !queue.data ? <Spinner label="Loading the sourcing queue" /> : null}

      {queue.data && entries.length === 0 ? (
        <EmptyState title="Nothing to source" message="Every open order has been sourced or resolved." />
      ) : null}

      {entries.length > 0 ? (
        <div className="table-wrap">
          <table className="table table--queue">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col">Stock</th>
                <th scope="col" className="num">
                  Estimate / unit
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            {entries.map(({ order, sourcing: detail }) => (
              <tbody key={order.id} className="order-group" aria-label={`Order ${order.order_number}`}>
                <tr className="order-group__head">
                  <th scope="rowgroup" colSpan={6}>
                    <div className="order-group__bar">
                      <span className="order-group__number mono">{order.order_number}</span>
                      <Status tone={order.order_status === 'PLACED' ? 'info' : 'warn'}>
                        {ORDER_STATUS_LABEL[order.order_status]}
                      </Status>
                      <span className="order-group__placed">Placed {formatDateTime(order.placed_at)}</span>
                      <span className="order-group__progress">
                        {isReadyToPack(detail)
                          ? 'Ready to pack'
                          : `${detail.metrics.pending_items} of ${detail.metrics.total_items} to source`}
                      </span>
                      {isReadyToPack(detail) && can(user?.role, 'markPacked') ? (
                        <button
                          type="button"
                          className="button button--sm"
                          onClick={() => setPacking({ order, sourcing: detail })}
                        >
                          Mark packed
                        </button>
                      ) : null}
                    </div>
                  </th>
                </tr>
                {detail.items.map((item) => {
                  const stockRow = stockByProduct.get(item.product_id);
                  const record = item.sourcing_records[0];
                  return (
                    <tr key={item.id} className={item.item_status === 'UNAVAILABLE' ? 'is-struck' : ''}>
                      <td>
                        <span className="cell__primary">{item.product_name_snapshot}</span>
                        <span className="cell__secondary mono nowrap">
                          {item.sku_snapshot} · {item.unit_snapshot}
                        </span>
                      </td>
                      <td className="num mono">{item.quantity}</td>
                      <td>
                        {stockRow?.tracking_mode === 'TRACKED' ? (
                          <span>
                            <span className="mono">{stockRow.quantity_on_hand}</span> counted
                          </span>
                        ) : (
                          <span className="cell__muted">Sourced on order</span>
                        )}
                      </td>
                      <td className="num mono">{formatMoney(item.estimated_unit_cost)}</td>
                      <td>
                        <Status tone={ITEM_TONE[item.item_status]}>{ITEM_STATUS_LABEL[item.item_status]}</Status>
                        {item.item_status === 'SOURCED' && item.actual_unit_cost !== null ? (
                          <span className="cell__secondary">
                            <span className="mono">{formatMoney(item.actual_unit_cost)}</span>
                            {record?.supplier ? ` · ${record.supplier.name}` : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="actions">
                        {item.item_status === 'PENDING' && can(user?.role, 'source') ? (
                          <>
                            <button type="button" className="button button--sm" onClick={() => setSourcing({ order, item })}>
                              Source
                            </button>
                            {can(user?.role, 'markUnavailable') ? (
                              <button
                                type="button"
                                className="button button--quiet button--sm"
                                onClick={() => setUnavailable({ order, item })}
                              >
                                Mark unavailable
                              </button>
                            ) : null}
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      ) : null}

      {sourcing ? (
        <SourceItemDialog
          order={sourcing.order}
          item={sourcing.item}
          stock={stockByProduct.get(sourcing.item.product_id)}
          suppliers={suppliers.data ?? []}
          onClose={() => setSourcing(null)}
          onSourced={async (message) => {
            setSourcing(null);
            toast.success(message);
            await refresh();
          }}
          onAlreadySourced={async () => {
            // Backend is authoritative: another operator got there first.
            setSourcing(null);
            setBanner(
              `${sourcing.item.product_name_snapshot} on ${sourcing.order.order_number} was already sourced by someone else. Showing the latest queue.`
            );
            await refresh();
          }}
          onMarkUnavailable={() => {
            setUnavailable(sourcing);
            setSourcing(null);
          }}
        />
      ) : null}

      {packing ? (
        <ConfirmDialog
          title="Mark order packed"
          confirmLabel="Mark packed"
          busy={packBusy}
          error={packError}
          onConfirm={() => void confirmPacked()}
          onCancel={() => {
            setPacking(null);
            setPackError(null);
          }}
        >
          <p>
            Order <span className="mono">{packing.order.order_number}</span> is packed with:
          </p>
          <ul className="consequences" aria-label="Packing list">
            {packing.sourcing.items
              .filter((i) => i.item_status === 'SOURCED')
              .map((i) => (
                <li key={i.id}>
                  <span className="mono">{i.quantity} ×</span> {i.product_name_snapshot}{' '}
                  <span className="cell__muted">({i.unit_snapshot})</span>
                </li>
              ))}
          </ul>
          <p>The order leaves the sourcing queue and is ready for delivery.</p>
        </ConfirmDialog>
      ) : null}

      {unavailable ? (
        <ConfirmDialog
          title="Mark item unavailable"
          confirmLabel="Mark unavailable"
          busy={unavailableBusy}
          error={unavailableError}
          onConfirm={() => void confirmUnavailable()}
          onCancel={() => {
            setUnavailable(null);
            setUnavailableError(null);
          }}
        >
          <p>
            Remove <strong>{unavailable.item.quantity} × {unavailable.item.product_name_snapshot}</strong> from order{' '}
            <span className="mono">{unavailable.order.order_number}</span>.
          </p>
          <ul className="consequences">
            <li>The order total drops by {formatMoney(unavailable.item.subtotal)}.</li>
            <li>The customer is notified that the item is unavailable.</li>
            <li>The item can no longer be sourced.</li>
          </ul>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
