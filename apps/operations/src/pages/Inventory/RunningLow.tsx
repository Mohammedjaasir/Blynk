import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/Layout';
import { useLowStock } from '../../components/LowStock';
import { Spinner } from '../../components/ui';
import { unitsLabel } from '../../lib/inventory';

/**
 * "Running low" - tracked products at or under their low-stock threshold,
 * out-of-stock first (the server's own order, `GET
 * /admin/inventory/low-stock`). Each row opens the product's stock page,
 * where it can be restocked or its threshold changed.
 */
export function RunningLow() {
  const { data, error, refresh } = useLowStock();

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
      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading low stock" /> : null}
      {data && data.items.length === 0 ? <p className="quiet quiet--ok">No tracked product is low or out of stock.</p> : null}
      {data && data.items.length > 0 ? (
        <ul className="cat-list">
          {data.items.map((item) => (
            <li key={item.product_id} className="cat-row cat-row--flat">
              <Link className="cat-row__main" to={`/catalog/inventory/stock/${item.product_id}`}>
                <p className="cat-row__title">{item.product_name}</p>
                <p className="cat-row__meta">
                  {item.product_sku} · {item.product_unit} · {item.category_name}
                </p>
                <div className="cat-row__badges">
                  <span className={`stock stock--${item.stock_state.toLowerCase()}`}>
                    <span className="stock__word">{item.stock_state === 'OUT' ? 'Out of stock' : 'Low stock'}</span>
                    <span className="stock__units">{unitsLabel(item.quantity_available)}</span>
                  </span>
                  <span className="cat-row__meta">Low at ≤ {item.low_stock_threshold}</span>
                </div>
              </Link>
              <div className="cat-row__actions">
                <Link className="button button--ghost button--sm" to={`/catalog/inventory/stock/${item.product_id}`}>
                  Restock
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
