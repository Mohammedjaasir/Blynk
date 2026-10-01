import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { inventory as inventoryApi } from '../../api/resources';
import type { LedgerEntry, StockRow } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { useLowStock } from '../../components/LowStock';
import { Spinner } from '../../components/ui';
import {
  ADJUSTMENT_LABEL,
  formatDateTime,
  formatDelta,
  inventoryErrorMessage,
  isOrderableButOut,
  stockState,
  unitsLabel,
} from '../../lib/inventory';

/** Worst first: orderable-but-empty, then out, then low. */
function attentionRank(row: StockRow) {
  if (isOrderableButOut(row)) return 0;
  return stockState(row).kind === 'OUT' ? 1 : 2;
}

/**
 * "What needs me right now?" (task F6, plan §13). Ported from
 * `apps/inventory/src/pages/Overview.tsx` (a fresh implementation, not an
 * import - common.md rule 2), adapted to this app's mobile card layout.
 * Three lists, each read straight from an endpoint - no totals, charts or
 * figures the backend doesn't produce (common.md rule 7).
 */
export function Overview() {
  const [attention, setAttention] = useState<StockRow[] | null>(null);
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const lowStock = useLowStock().data;

  useEffect(() => {
    void inventoryApi.stock
      .list({ low_stock_only: true, limit: 100 })
      .then((r) => setAttention(r.inventory))
      .catch((err) => {
        setAttentionError(inventoryErrorMessage(err, 'Could not load stock that needs attention.'));
        setAttention([]);
      });
    void inventoryApi.ledger
      .list({ limit: 8 })
      .then((r) => setLedger(r.adjustments))
      .catch((err) => {
        setLedgerError(inventoryErrorMessage(err, 'Could not load the ledger.'));
        setLedger([]);
      });
  }, []);

  const attentionRows = [...(attention ?? [])].sort(
    (a, b) => attentionRank(a) - attentionRank(b) || a.product_name.localeCompare(b.product_name)
  );
  const orderableEmpty = attentionRows.filter(isOrderableButOut).length;

  return (
    <div className="page">
      <PageHeader title="Inventory" description="Stock and suppliers." />

      <ul className="cat-hub">
        <li>
          <Link className="cat-hub__card" to="/catalog/inventory/low-stock">
            <span className="cat-hub__title">Running low</span>
            <span className="cat-hub__count">{lowStock ? lowStock.counts.total : '—'}</span>
          </Link>
        </li>
      </ul>

      <section className="section" aria-labelledby="attention-title">
        <div className="page-header">
          <h2 className="section-label" id="attention-title">
            Needs stock
          </h2>
          <Link className="text-button" to="/catalog/inventory/stock?view=low">
            Open in Stock →
          </Link>
        </div>
        {attentionError ? <p className="field__error">{attentionError}</p> : null}
        {attention === null ? <Spinner label="Loading stock that needs attention" /> : null}
        {attention && attentionRows.length === 0 ? <p className="quiet quiet--ok">No tracked product is low or out of stock.</p> : null}
        {orderableEmpty > 0 ? (
          <p className="field__error" role="alert">
            {orderableEmpty} {orderableEmpty === 1 ? 'product is' : 'products are'} orderable but out of stock.
            Customers can still order {orderableEmpty === 1 ? 'it' : 'them'}, and packing will fail.
          </p>
        ) : null}
        {attentionRows.length > 0 ? (
          <ul className="cat-list">
            {attentionRows.slice(0, 6).map((row) => {
              const state = stockState(row);
              return (
                <li key={row.product_id} className="cat-row cat-row--flat">
                  <Link className="cat-row__main" to={`/catalog/inventory/stock/${row.product_id}`}>
                    <p className="cat-row__title">{row.product_name}</p>
                    <div className="cat-row__badges">
                      <span className={`stock stock--${state.kind.toLowerCase()}`}>
                        <span className="stock__word">{state.label}</span>
                        {state.units !== null ? <span className="stock__units">{unitsLabel(state.units)}</span> : null}
                      </span>
                      {isOrderableButOut(row) ? <span className="flag flag--bad">Orderable but out</span> : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        {attentionRows.length > 6 ? <p className="quiet">and {attentionRows.length - 6} more.</p> : null}
      </section>

      <section className="section" aria-labelledby="ledger-title">
        <div className="page-header">
          <h2 className="section-label" id="ledger-title">
            Latest stock movements
          </h2>
          <Link className="text-button" to="/catalog/inventory/ledger">
            Full ledger →
          </Link>
        </div>
        {ledgerError ? <p className="field__error">{ledgerError}</p> : null}
        {ledger === null ? <Spinner label="Loading the ledger" /> : null}
        {ledger && ledger.length === 0 ? <p className="quiet">No stock movements recorded yet.</p> : null}
        {ledger && ledger.length > 0 ? (
          <ul className="cat-list">
            {ledger.map((a) => (
              <li key={a.id} className="cat-row cat-row--flat">
                <div className="cat-row__main">
                  <p className="cat-row__title">{a.product_name}</p>
                  <p className="cat-row__meta">
                    {ADJUSTMENT_LABEL[a.adjustment_type]} · {formatDateTime(a.created_at)}
                  </p>
                </div>
                <div className="cat-row__actions">
                  <span className={`delta mono ${a.quantity_delta > 0 ? 'delta--up' : 'delta--down'}`}>{formatDelta(a.quantity_delta)}</span>
                  <span className="mono">{a.new_quantity}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="section">
        <Link className="button" to="/catalog/inventory/suppliers">
          Suppliers
        </Link>
      </section>
    </div>
  );
}
