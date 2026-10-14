import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LowStockItem } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { useLowStock } from '../../components/LowStock';
import { Spinner } from '../../components/ui';
import { stockRowKey, stockRowName, unitsLabel } from '../../lib/inventory';
import { AdjustDialog } from './AdjustDialog';

/**
 * "Running low" - tracked products at or under their low-stock threshold,
 * out-of-stock first (the server's own order, `GET
 * /admin/inventory/low-stock`). Each product row opens the product's stock
 * page, where it can be restocked or its threshold changed.
 *
 * Migration 045: a variant (e.g. "Chilli Powder - 100 g") has its own stock
 * row. It is listed by its display name, keyed by product + variant so two
 * sizes of one product never collide, and its Restock opens the adjustment
 * right here with that variant's id (the stock page is the product's own).
 */
export function RunningLow() {
  const { data, error, refresh } = useLowStock();
  const [adjusting, setAdjusting] = useState<LowStockItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Running low"
        description={
          data
            ? `${data.counts.out} out of stock · ${data.counts.low} low`
            : 'Tracked products at or under their low-stock level.'
        }
        actions={
          <>
            {/* Purchase list (owner, 2026-10-10). */}
            <Link className="button button--sm" to="/catalog/inventory/purchase-list">
              Purchase list
            </Link>
            <button type="button" className="button button--ghost" onClick={() => void refresh()}>
              Refresh
            </button>
          </>
        }
      />
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading low stock" /> : null}
      {data && data.items.length === 0 ? <p className="quiet quiet--ok">No tracked product is low or out of stock.</p> : null}
      {data && data.items.length > 0 ? (
        <ul className="cat-list">
          {data.items.map((item) => {
            const name = stockRowName(item);
            const isVariant = Boolean(item.variant_id);
            return (
              <li key={stockRowKey(item)} className="cat-row cat-row--flat">
                <Link className="cat-row__main" to={`/catalog/inventory/stock/${item.product_id}`}>
                  <p className="cat-row__title">{name}</p>
                  <p className="cat-row__meta">
                    {isVariant ? (item.variant_sku ?? item.product_sku) : `${item.product_sku} · ${item.product_unit}`} ·{' '}
                    {item.category_name}
                  </p>
                  <div className="cat-row__badges">
                    <span className={`stock stock--${item.stock_state.toLowerCase()}`}>
                      <span className="stock__word">{item.stock_state === 'OUT' ? 'Out of stock' : 'Low stock'}</span>
                      <span className="stock__units">{unitsLabel(item.quantity_available)}</span>
                    </span>
                    <span className="cat-row__meta">Low at ≤ {item.low_stock_threshold}</span>
                  </div>
                  {item.quantity_in_open_orders ? (
                    <p className="cat-row__meta">
                      {item.quantity_in_open_orders} in open orders · {item.quantity_sellable ?? 0} left to sell
                    </p>
                  ) : null}
                </Link>
                <div className="cat-row__actions">
                  {isVariant ? (
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Restock ${name}`}
                      onClick={() => {
                        setNotice(null);
                        setAdjusting(item);
                      }}
                    >
                      Restock
                    </button>
                  ) : (
                    <Link className="button button--ghost button--sm" to={`/catalog/inventory/stock/${item.product_id}`}>
                      Restock
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {adjusting ? (
        <AdjustDialog
          detail={{
            product_id: adjusting.product_id,
            product_name: stockRowName(adjusting),
            quantity_on_hand: adjusting.quantity_on_hand,
            quantity_reserved: adjusting.quantity_reserved,
          }}
          variantId={adjusting.variant_id}
          onClose={() => setAdjusting(null)}
          onDone={async (onHand) => {
            setNotice(`${stockRowName(adjusting)}: ${onHand} on hand.`);
            setAdjusting(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}
