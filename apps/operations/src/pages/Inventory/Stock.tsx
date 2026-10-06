import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { inventory as inventoryApi } from '../../api/resources';
import type { StockRow } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner } from '../../components/ui';
import { inventoryErrorMessage, isOrderableButOut, stockState, unitsLabel } from '../../lib/inventory';

type View = 'all' | 'tracked' | 'untracked' | 'low';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'tracked', label: 'Tracked' },
  { id: 'untracked', label: 'Untracked' },
  { id: 'low', label: 'Low & out' },
];

/**
 * Every catalog product and its stock (task F6, plan §13). Ported from
 * `apps/inventory/src/pages/Stock.tsx` (a fresh implementation, not an
 * import - common.md rule 2), as a mobile card list rather than Inventory's
 * desktop `<table>` - the same departure F3/F5 made for the same reason.
 * Tapping a row navigates to `/catalog/inventory/stock/:productId`
 * (`StockDetail.tsx`) rather than opening a side panel, matching F3's own
 * "full page, not a slide-over" choice for the same mobile-first Layout.
 *
 * The list comes from the backend's products-first endpoint, so a product
 * created in Catalog appears here before it has ever been tracked. Filters
 * live in the URL, matching Stock/Products' own established convention
 * (F5's `Products.tsx`).
 */
export function Stock() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const view = (params.get('view') as View) || 'all';
  const includeInactive = params.get('inactive') === '1';

  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  }

  const load = useCallback(async () => {
    try {
      const query = params.get('q') ?? '';
      const rows = await inventoryApi.stock.listAll({
        search: query.trim() || undefined,
        tracking_mode: view === 'tracked' ? 'TRACKED' : view === 'untracked' ? 'UNTRACKED' : undefined,
        low_stock_only: view === 'low' || undefined,
        include_inactive: includeInactive || undefined,
      });
      setRows(rows);
      setError(null);
    } catch (err) {
      setError(inventoryErrorMessage(err, 'Could not load stock.'));
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, view, includeInactive]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="page">
      <PageHeader
        title="Stock"
        description="Every product in the catalog and its stock. Customer availability is set in Catalog and shown here read-only."
      />

      <div className="filters">
        <input
          className="input"
          type="search"
          placeholder="Search name or SKU"
          aria-label="Search products by name or SKU"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            update({ q: event.target.value || null });
          }}
        />
        <div className="segmented" role="group" aria-label="Stock view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`segmented__item${view === v.id ? ' is-selected' : ''}`}
              aria-pressed={view === v.id}
              onClick={() => update({ view: v.id === 'all' ? null : v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => update({ inactive: event.target.checked ? '1' : null })}
          />
          <span>Include inactive products</span>
        </label>
      </div>

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading stock" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={search ? `No products match "${search}"` : 'No products in this view'}
          message={view === 'low' ? 'No tracked product is low or out of stock.' : 'Try another search, or include inactive products.'}
        />
      ) : (
        <ul className="cat-list">
          {rows.map((row) => {
            const state = stockState(row);
            return (
              <li key={row.product_id} className={`cat-row cat-row--flat${!row.is_active ? ' is-muted' : ''}`}>
                <Link className="cat-row__main" to={`/catalog/inventory/stock/${row.product_id}`}>
                  <p className="cat-row__title">{row.product_name}</p>
                  <p className="cat-row__meta">
                    {row.product_sku} · {row.product_unit} · {row.category_name}
                  </p>
                  <div className="cat-row__badges">
                    <span className={`stock stock--${state.kind.toLowerCase()}`}>
                      <span className="stock__word">{state.label}</span>
                      {state.units !== null ? <span className="stock__units">{unitsLabel(state.units)}</span> : null}
                    </span>
                    <span className={`mode mode--${row.tracking_mode.toLowerCase()}`}>{row.tracking_mode}</span>
                    {isOrderableButOut(row) ? <span className="flag flag--bad">Orderable but out of stock</span> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
