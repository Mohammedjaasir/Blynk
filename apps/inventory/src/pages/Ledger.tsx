import { useSearchParams } from 'react-router-dom';
import { ledgerApi, stockApi } from '../api/resources';
import type { AdjustmentType } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, LoadError, Pager, SkeletonRows } from '../components/ui';
import { ADJUSTMENT_LABEL, formatDateTime, formatDelta } from '../lib/format';
import { useLoad } from '../lib/useLoad';

const PAGE_SIZE = 50;
const TYPES = Object.keys(ADJUSTMENT_LABEL) as AdjustmentType[];

/** Local calendar day → the instant range the backend filters on. */
const startOfDay = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/**
 * Every stock movement, newest first, exactly as the backend orders it.
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

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  }

  const products = useLoad(() => stockApi.list({ include_inactive: true, limit: 100 }), []);
  const { data, error, loading, reload } = useLoad(
    () =>
      ledgerApi.list({
        product_id: productId || undefined,
        type: type || undefined,
        from: from ? startOfDay(from) : undefined,
        to: to ? endOfDay(to) : undefined,
        page,
        limit: PAGE_SIZE,
      }),
    [productId, type, from, to, page]
  );

  const filtered = Boolean(productId || type || from || to);
  const rows = data?.adjustments ?? [];

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every stock movement, newest first. Entries are permanent; corrections are new entries."
      />

      <div className="toolbar">
        <select
          className="input"
          aria-label="Filter by product"
          value={productId}
          onChange={(event) => update({ product: event.target.value })}
        >
          <option value="">All products</option>
          {(products.data?.inventory ?? []).map((p) => (
            <option key={p.product_id} value={p.product_id}>
              {p.product_name}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Filter by adjustment type"
          value={type}
          onChange={(event) => update({ type: event.target.value })}
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {ADJUSTMENT_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="date-field">
          <span>From</span>
          <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => update({ from: e.target.value })} />
        </label>
        <label className="date-field">
          <span>To</span>
          <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => update({ to: e.target.value })} />
        </label>
        {filtered ? (
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? <LoadError error={error} onRetry={() => void reload()} /> : null}

      <div className="table-wrap">
        <table className="table table--ledger">
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
              <th scope="col">Note</th>
            </tr>
          </thead>
          {loading && !data ? (
            <SkeletonRows columns={7} />
          ) : (
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono cell__secondary nowrap">{formatDateTime(entry.created_at)}</td>
                  <td>
                    <span className="cell__primary">{entry.product_name}</span>
                    <span className="cell__secondary mono">{entry.product_sku}</span>
                  </td>
                  <td>{ADJUSTMENT_LABEL[entry.adjustment_type]}</td>
                  <td className={`num mono delta ${entry.quantity_delta > 0 ? 'delta--up' : 'delta--down'}`}>
                    {formatDelta(entry.quantity_delta)}
                  </td>
                  <td className="num mono nowrap">
                    <span className="cell__muted">{entry.previous_quantity} → </span>
                    {entry.new_quantity}
                  </td>
                  <td>
                    {entry.actor_name ?? <span className="cell__secondary">Not recorded</span>}
                    {entry.actor_name && entry.actor_role === 'CUSTOMER' ? (
                      <span className="cell__muted"> · customer</span>
                    ) : null}
                  </td>
                  <td className="cell__secondary note-cell">{entry.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {data && rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No entries match these filters' : 'No stock movements yet'}
          message={
            filtered
              ? 'Widen the date range or clear a filter.'
              : 'Restocks, write-offs, counts and sourcing from tracked stock will appear here.'
          }
        />
      ) : null}
      {data && data.pagination.total_pages > 1 ? (
        <Pager
          page={data.pagination.page}
          totalPages={data.pagination.total_pages}
          total={data.pagination.total}
          noun="entry"
          plural="entries"
          onPage={(p) => update({ page: String(p) })}
        />
      ) : null}
    </>
  );
}
