import { useState } from 'react';
import { sourcingApi, stockApi, suppliersApi } from '../api/resources';
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

/** Open orders with items still to source, oldest first (first in, first out). */
export async function loadQueue(): Promise<QueueEntry[]> {
  const orders = await sourcingApi.openOrders();
  const details = await Promise.all(orders.map((o) => sourcingApi.detail(o.id)));
  return orders
    .map((order, i) => ({ order, sourcing: details[i] }))
    .filter((entry) => entry.sourcing.metrics.pending_items > 0)
    .sort((a, b) => a.order.placed_at.localeCompare(b.order.placed_at) || a.order.id.localeCompare(b.order.id));
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
  const stock = useLoad(() => stockApi.list({ include_inactive: true, limit: 100 }), []);
  const suppliers = useLoad(() => suppliersApi.list(true), []);
  const [sourcing, setSourcing] = useState<{ order: QueueOrder; item: SourcingItem } | null>(null);
  const [unavailable, setUnavailable] = useState<{ order: QueueOrder; item: SourcingItem } | null>(null);
  const [unavailableBusy, setUnavailableBusy] = useState(false);
  const [unavailableError, setUnavailableError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const stockByProduct = new Map<string, StockRow>((stock.data?.inventory ?? []).map((r) => [r.product_id, r]));
  const entries = queue.data ?? [];
  const pendingItems = entries.reduce((sum, e) => sum + e.sourcing.metrics.pending_items, 0);

  async function refresh() {
    await Promise.all([queue.reload(), stock.reload()]);
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
              ? `${entries.length} ${entries.length === 1 ? 'order' : 'orders'} · ${pendingItems} ${pendingItems === 1 ? 'item' : 'items'} to source, oldest first.`
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
                        {detail.metrics.pending_items} of {detail.metrics.total_items} to source
                      </span>
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
