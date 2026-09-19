import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { stockApi, type StockQuery } from '../api/resources';
import type { StockRow } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, LoadError, Pager, SkeletonRows, Status, StockStatus } from '../components/ui';
import { formatDate } from '../lib/format';
import { isOrderableButOut } from '../lib/stock';
import { useDebounced, useLoad } from '../lib/useLoad';
import { StockPanel } from './StockPanel';

const PAGE_SIZE = 50;
type View = 'all' | 'tracked' | 'untracked' | 'low';
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'tracked', label: 'Tracked' },
  { id: 'untracked', label: 'Untracked' },
  { id: 'low', label: 'Low & out' },
];

/**
 * Every catalog product and its stock. The list comes from the backend's
 * products-first endpoint, so a product created in Admin appears here before
 * it has ever been tracked. Filters live in the URL so a view can be shared
 * and survives back/forward.
 */
export function Stock() {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const view = (params.get('view') as View) || 'all';
  const includeInactive = params.get('inactive') === '1';
  const page = Number(params.get('page') ?? '1') || 1;
  const selected = params.get('product');
  const debouncedSearch = useDebounced(search);
  const searchRef = useRef<HTMLInputElement>(null);

  function update(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }

  const query: StockQuery = {
    search: debouncedSearch.trim() || undefined,
    tracking_mode: view === 'tracked' ? 'TRACKED' : view === 'untracked' ? 'UNTRACKED' : undefined,
    low_stock_only: view === 'low' || undefined,
    include_inactive: includeInactive || undefined,
    page,
    limit: PAGE_SIZE,
  };
  const { data, error, loading, reload } = useLoad(
    () => stockApi.list(query),
    [debouncedSearch, view, includeInactive, page]
  );

  // "/" jumps to search from anywhere on the page, as in most operations tools.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(target.tagName)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const rows = data?.inventory ?? [];
  const selectedRow = rows.find((r) => r.product_id === selected);

  function onRowKey(event: KeyboardEvent<HTMLTableRowElement>, row: StockRow) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      update({ product: row.product_id }, false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const sibling =
        event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
      (sibling as HTMLElement | null)?.focus();
    }
  }

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every product in the catalog and its stock. Customer availability is set in Admin and shown here read-only."
      />

      <div className="toolbar">
        <input
          ref={searchRef}
          className="input toolbar__search"
          type="search"
          placeholder="Search name or SKU  ( / )"
          aria-label="Search products by name or SKU"
          value={search}
          onChange={(event) => update({ q: event.target.value })}
        />
        <div className="segmented" role="group" aria-label="Stock view">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className="segmented__option"
              aria-pressed={view === v.id}
              onClick={() => update({ view: v.id === 'all' ? null : v.id })}
            >
              {v.label}
            </button>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => update({ inactive: event.target.checked ? '1' : null })}
          />
          Include inactive products
        </label>
      </div>

      <div className={`workspace${selected ? ' workspace--with-panel' : ''}`}>
        <div className="workspace__main">
          {error ? <LoadError error={error} onRetry={() => void reload()} /> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="col-product">
                    Product
                  </th>
                  <th scope="col" className="col-secondary">
                    Category
                  </th>
                  <th scope="col">Tracking</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Customer (Admin)</th>
                  <th scope="col" className="col-secondary">
                    Updated
                  </th>
                </tr>
              </thead>
              {loading && !data ? (
                <SkeletonRows columns={6} />
              ) : (
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.product_id}
                      tabIndex={0}
                      className={`row-link${row.product_id === selected ? ' is-selected' : ''}${!row.is_active ? ' is-muted' : ''}`}
                      aria-selected={row.product_id === selected}
                      onClick={() => update({ product: row.product_id }, false)}
                      onKeyDown={(event) => onRowKey(event, row)}
                    >
                      <td className="col-product">
                        <span className="cell__primary">{row.product_name}</span>
                        <span className="cell__secondary mono nowrap">
                          {row.product_sku} · {row.product_unit}
                        </span>
                      </td>
                      <td className="cell__secondary col-secondary">{row.category_name}</td>
                      <td>
                        <span className={`mode mode--${row.tracking_mode.toLowerCase()}`}>{row.tracking_mode}</span>
                      </td>
                      <td>
                        <StockStatus row={row} />
                      </td>
                      <td>
                        <CustomerState row={row} compact />
                      </td>
                      <td className="cell__secondary col-secondary nowrap">
                        {row.updated_at ? formatDate(row.updated_at) : 'Never counted'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {data && rows.length === 0 ? (
            <EmptyState
              title={search ? `No products match “${search}”` : 'No products in this view'}
              message={
                view === 'low'
                  ? 'No tracked product is low or out of stock.'
                  : 'Try another search, or include inactive products.'
              }
            />
          ) : null}
          {data && data.pagination.total_pages > 1 ? (
            <Pager
              page={data.pagination.page}
              totalPages={data.pagination.total_pages}
              total={data.pagination.total}
              noun="product"
              onPage={(p) => update({ page: String(p) }, false)}
            />
          ) : null}
        </div>

        {selected ? (
          <StockPanel
            key={selected}
            productId={selected}
            row={selectedRow}
            onClose={() => update({ product: null }, false)}
            onChanged={() => void reload()}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * Admin-owned customer state, read-only, plus the D1 warning. In the table
 * (compact) the normal case - active and available - reads as one word,
 * "Orderable", so the exceptions stand out; the panel spells both out.
 */
export function CustomerState({ row, compact = false }: { row: StockRow; compact?: boolean }) {
  const normal = row.is_active && row.is_available;
  return (
    <span className="customer-state">
      {compact && normal ? (
        <Status tone="ok">Orderable</Status>
      ) : (
        <>
          <Status tone={row.is_active ? 'ok' : 'muted'}>{row.is_active ? 'Active' : 'Inactive'}</Status>
          <Status tone={row.is_available ? 'ok' : 'muted'}>{row.is_available ? 'Available' : 'Unavailable'}</Status>
        </>
      )}
      {isOrderableButOut(row) ? <span className="flag flag--bad">Orderable but out of stock</span> : null}
    </span>
  );
}
