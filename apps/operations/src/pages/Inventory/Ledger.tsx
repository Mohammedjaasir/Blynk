import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { inventory as inventoryApi } from '../../api/resources';
import type { AdjustmentType, LedgerEntry, StockRow } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner } from '../../components/ui';
import { ADJUSTMENT_LABEL, formatDateTime, formatDelta, inventoryErrorMessage } from '../../lib/inventory';

const PAGE_SIZE = 50;
const TYPES = Object.keys(ADJUSTMENT_LABEL) as AdjustmentType[];

/** Local calendar day → the instant range the backend filters on. */
const startOfDay = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/**
 * Every stock movement, newest first, exactly as the backend orders it (task
 * F6, plan §13). Ported from `apps/inventory/src/pages/Ledger.tsx` (a fresh
 * implementation, not an import - common.md rule 2), as a mobile card list.
 * Manual adjustments and the sourcing fulfilments that take tracked stock
 * both appear here. The ledger is append-only: nothing on this screen edits.
 */
export function Ledger() {
  const [params, setParams] = useSearchParams();
  const productId = params.get('product') ?? '';
  const type = (params.get('type') ?? '') as AdjustmentType | '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;

  const [products, setProducts] = useState<StockRow[]>([]);
  const [rows, setRows] = useState<LedgerEntry[] | null>(null);
  const [pagination, setPagination] = useState<{ total: number; total_pages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }

  useEffect(() => {
    void inventoryApi.stock
      .listAll({ include_inactive: true })
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await inventoryApi.ledger.list({
        product_id: productId || undefined,
        type: type || undefined,
        from: from ? startOfDay(from) : undefined,
        to: to ? endOfDay(to) : undefined,
        page,
        limit: PAGE_SIZE,
      });
      setRows(result.adjustments);
      setPagination({ total: result.pagination.total, total_pages: result.pagination.total_pages });
      setError(null);
    } catch (err) {
      setError(inventoryErrorMessage(err, 'Could not load the ledger.'));
      setRows([]);
    }
  }, [productId, type, from, to, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = Boolean(productId || type || from || to);

  return (
    <div className="page">
      <PageHeader title="Ledger" description="Every stock movement, newest first. Entries are permanent; corrections are new entries." />

      <div className="filters">
        <select className="input" aria-label="Filter by product" value={productId} onChange={(e) => update({ product: e.target.value })}>
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.product_id} value={p.product_id}>
              {p.product_name}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Filter by adjustment type" value={type} onChange={(e) => update({ type: e.target.value })}>
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {ADJUSTMENT_LABEL[t]}
            </option>
          ))}
        </select>
        <div className="form__row">
          <label className="field">
            <span className="field__label">From</span>
            <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">To</span>
            <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} />
          </label>
        </div>
        {filtered ? (
          <button type="button" className="button button--ghost button--sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading the ledger" />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No entries match these filters' : 'No stock movements yet'}
          message={filtered ? 'Widen the date range or clear a filter.' : 'Restocks, write-offs, counts and sourcing from tracked stock will appear here.'}
        />
      ) : (
        <ul className="cat-list">
          {rows.map((entry) => (
            <li key={entry.id} className="cat-row cat-row--flat">
              <div className="cat-row__main">
                <p className="cat-row__title">{entry.product_name}</p>
                <p className="cat-row__meta">
                  {ADJUSTMENT_LABEL[entry.adjustment_type]} · {formatDateTime(entry.created_at)}
                </p>
                <p className="cat-row__meta">
                  {entry.actor_name ?? 'Not recorded'}
                  {entry.actor_name && entry.actor_role === 'CUSTOMER' ? ' · customer' : ''}
                </p>
                {entry.notes ? <p className="cat-row__meta">{entry.notes}</p> : null}
              </div>
              <div className="cat-row__actions">
                <span className={`delta mono ${entry.quantity_delta > 0 ? 'delta--up' : 'delta--down'}`}>{formatDelta(entry.quantity_delta)}</span>
                <span className="mono cat-row__order">
                  {entry.previous_quantity} → {entry.new_quantity}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.total_pages > 1 ? (
        <nav className="filters" aria-label="Pages">
          <span className="page__note">
            {pagination.total} {pagination.total === 1 ? 'entry' : 'entries'} · page {page} of {pagination.total_pages}
          </span>
          <div className="actions-row">
            <button type="button" className="button button--ghost button--sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
              Previous
            </button>
            <button
              type="button"
              className="button button--ghost button--sm"
              disabled={page >= pagination.total_pages}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
