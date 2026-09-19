import { Link } from 'react-router-dom';
import { ledgerApi, stockApi } from '../api/resources';
import type { StockRow } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { LoadError, Spinner, StockStatus } from '../components/ui';
import { ADJUSTMENT_LABEL, formatDateTime, formatDelta } from '../lib/format';
import { isOrderableButOut, stockState } from '../lib/stock';
import { useLoad } from '../lib/useLoad';
import { loadQueue } from './SourcingQueue';

/** Worst first: orderable-but-empty, then out, then low. */
function attentionRank(row: StockRow) {
  if (isOrderableButOut(row)) return 0;
  return stockState(row).kind === 'OUT' ? 1 : 2;
}

/**
 * "What needs me right now?" Three lists, each read straight from an
 * endpoint - no totals, charts or figures the backend doesn't produce.
 */
export function Overview() {
  const { user } = useAuth();
  const attention = useLoad(() => stockApi.list({ low_stock_only: true, limit: 100 }), []);
  const queue = useLoad(loadQueue, []);
  const ledger = useLoad(() => ledgerApi.list({ limit: 8 }), []);

  const attentionRows = [...(attention.data?.inventory ?? [])].sort(
    (a, b) => attentionRank(a) - attentionRank(b) || a.product_name.localeCompare(b.product_name)
  );
  const orderableEmpty = attentionRows.filter(isOrderableButOut).length;
  const queueEntries = queue.data ?? [];
  const pendingItems = queueEntries.reduce((sum, e) => sum + e.sourcing.metrics.pending_items, 0);

  const firstName = user?.full_name?.split(' ')[0];

  return (
    <>
      <PageHeader
        title="Overview"
        description={firstName ? `What needs attention, ${firstName}.` : 'What needs attention.'}
      />

      <div className="overview">
        <section className="overview__section" aria-labelledby="attention-title">
          <div className="section-head">
            <h2 id="attention-title" className="section-head__title">
              Needs stock
            </h2>
            {attention.data ? (
              <span className="section-head__count mono">{attentionRows.length}</span>
            ) : null}
            <Link className="text-link" to="/stock?view=low">
              Open in Inventory →
            </Link>
          </div>
          {attention.error ? <LoadError error={attention.error} onRetry={() => void attention.reload()} /> : null}
          {attention.loading && !attention.data ? <Spinner label="Loading stock that needs attention" /> : null}
          {attention.data && attentionRows.length === 0 ? (
            <p className="quiet quiet--ok">No tracked product is low or out of stock.</p>
          ) : null}
          {orderableEmpty > 0 ? (
            <p className="notice notice--bad">
              <strong>
                {orderableEmpty} {orderableEmpty === 1 ? 'product is' : 'products are'} orderable but out of stock.
              </strong>{' '}
              Customers can still order {orderableEmpty === 1 ? 'it' : 'them'}, and sourcing will fail. Restock, or ask
              an admin to mark {orderableEmpty === 1 ? 'it' : 'them'} unavailable in Admin.
            </p>
          ) : null}
          {attentionRows.length > 0 ? (
            <ul className="attention-list">
              {attentionRows.map((row) => (
                <li key={row.product_id}>
                  <Link to={`/stock?product=${row.product_id}`} className="attention-list__name">
                    {row.product_name}
                  </Link>
                  <StockStatus row={row} />
                  {isOrderableButOut(row) ? <span className="flag flag--bad">Orderable but out of stock</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="overview__section" aria-labelledby="queue-title">
          <div className="section-head">
            <h2 id="queue-title" className="section-head__title">
              Waiting to be sourced
            </h2>
            {queue.data ? <span className="section-head__count mono">{pendingItems}</span> : null}
            <Link className="text-link" to="/sourcing">
              Open the queue →
            </Link>
          </div>
          {queue.error ? <LoadError error={queue.error} onRetry={() => void queue.reload()} /> : null}
          {queue.loading && !queue.data ? <Spinner label="Loading the sourcing queue" /> : null}
          {queue.data && queueEntries.length === 0 ? <p className="quiet">Nothing waiting to be sourced.</p> : null}
          {queueEntries.length > 0 ? (
            <ul className="queue-list">
              {queueEntries.slice(0, 6).map(({ order, sourcing }) => (
                <li key={order.id}>
                  <span className="mono queue-list__number">{order.order_number}</span>
                  <span className="cell__secondary">{formatDateTime(order.placed_at)}</span>
                  <span className="queue-list__count">
                    <span className="mono">{sourcing.metrics.pending_items}</span> to source
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {queueEntries.length > 6 ? (
            <p className="quiet">and {queueEntries.length - 6} more in the queue.</p>
          ) : null}
        </section>

        <section className="overview__section overview__section--wide" aria-labelledby="ledger-title">
          <div className="section-head">
            <h2 id="ledger-title" className="section-head__title">
              Latest stock movements
            </h2>
            <Link className="text-link" to="/ledger">
              Full ledger →
            </Link>
          </div>
          {ledger.error ? <LoadError error={ledger.error} onRetry={() => void ledger.reload()} /> : null}
          {ledger.loading && !ledger.data ? <Spinner label="Loading the ledger" /> : null}
          {ledger.data && ledger.data.adjustments.length === 0 ? (
            <p className="quiet">No stock movements recorded yet.</p>
          ) : null}
          {ledger.data && ledger.data.adjustments.length > 0 ? (
            <div className="table-wrap table-wrap--flush">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Product</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">
                      Change
                    </th>
                    <th scope="col" className="num">
                      On hand
                    </th>
                    <th scope="col">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.adjustments.map((a) => (
                    <tr key={a.id}>
                      <td className="mono nowrap cell__muted">{formatDateTime(a.created_at)}</td>
                      <td>
                        <span className="cell__primary">{a.product_name}</span>
                      </td>
                      <td className="nowrap">{ADJUSTMENT_LABEL[a.adjustment_type]}</td>
                      <td className={`num mono delta ${a.quantity_delta > 0 ? 'delta--up' : 'delta--down'}`}>
                        {formatDelta(a.quantity_delta)}
                      </td>
                      <td className="num mono">{a.new_quantity}</td>
                      <td className="nowrap">{a.actor_name ?? <span className="cell__muted">Not recorded</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
