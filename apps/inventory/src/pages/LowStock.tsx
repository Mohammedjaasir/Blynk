import { Link } from 'react-router-dom';
import { stockApi } from '../api/resources';
import type { LowStockItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/can';
import { PageHeader } from '../components/Layout';
import { EmptyState, LoadError, Spinner } from '../components/ui';
import { unitsLabel } from '../lib/stock';
import { useLoad } from '../lib/useLoad';

/**
 * Tracked products at or below their low-stock threshold, straight from
 * GET /admin/inventory/low-stock. Out of stock and running low are separate
 * lists: an OUT product fails sourcing today, a LOW one soon. Each product
 * opens its stock panel on the Inventory page, where an admin restocks it.
 */
export function LowStock() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => stockApi.lowStock(), []);
  const items = data?.items ?? [];
  const out = items.filter((i) => i.stock_state === 'OUT');
  const low = items.filter((i) => i.stock_state === 'LOW');
  const openLabel = can(user?.role, 'adjustStock') ? 'Restock' : 'View stock';

  return (
    <>
      <PageHeader
        title="Running low"
        description="Tracked products at or below their low-stock threshold. Untracked products are sourced on order and never appear here."
      />

      {error ? <LoadError error={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Spinner label="Loading products running low" /> : null}

      {data ? (
        <p className="lowstock-counts" aria-label="Low-stock counts">
          <span className="stock stock--out">
            <span className="stock__word">Out of stock</span>
            <span className="stock__units">{data.counts.out}</span>
          </span>
          <span className="stock stock--low">
            <span className="stock__word">Low stock</span>
            <span className="stock__units">{data.counts.low}</span>
          </span>
        </p>
      ) : null}

      {data && items.length === 0 ? (
        <EmptyState title="Nothing is running low" message="No tracked product is low or out of stock." />
      ) : null}

      {out.length > 0 ? (
        <LowStockTable id="out" title="Out of stock" rows={out} openLabel={openLabel} />
      ) : null}
      {low.length > 0 ? (
        <LowStockTable id="low" title="Low stock" rows={low} openLabel={openLabel} />
      ) : null}
    </>
  );
}

function LowStockTable({
  id,
  title,
  rows,
  openLabel,
}: {
  id: string;
  title: string;
  rows: LowStockItem[];
  openLabel: string;
}) {
  const headingId = `lowstock-${id}-title`;
  return (
    <section className="lowstock-section" aria-labelledby={headingId}>
      <div className="section-head">
        <h2 id={headingId} className="section-head__title">
          {title}
        </h2>
        <span className="section-head__count mono">{rows.length}</span>
      </div>
      <div className="table-wrap table-wrap--flush">
        <table className="table table--compact">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="col-secondary">
                Category
              </th>
              <th scope="col" className="num">
                Available
              </th>
              <th scope="col" className="num">
                On hand
              </th>
              <th scope="col" className="num">
                Reserved
              </th>
              <th scope="col" className="num">
                Low at
              </th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.product_id}>
                <td>
                  <Link className="attention-list__name" to={`/stock?product=${row.product_id}`}>
                    {row.product_name}
                  </Link>
                  <span className="cell__secondary mono nowrap">
                    {row.product_sku} · {row.product_unit}
                  </span>
                </td>
                <td className="cell__secondary col-secondary">{row.category_name}</td>
                <td className="num mono">
                  <span className={`stock stock--${row.stock_state.toLowerCase()}`}>
                    <span className="stock__word">{row.stock_state === 'OUT' ? 'Out of stock' : 'Low stock'}</span>
                    <span className="stock__units">{unitsLabel(Math.max(0, row.quantity_available))}</span>
                  </span>
                </td>
                <td className="num mono">{row.quantity_on_hand}</td>
                <td className="num mono">{row.quantity_reserved}</td>
                <td className="num mono">≤ {row.low_stock_threshold}</td>
                <td className="nowrap">
                  <Link
                    className="text-link"
                    to={`/stock?product=${row.product_id}`}
                    aria-label={`${openLabel}: ${row.product_name}`}
                  >
                    {openLabel} →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
