import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { purchasing, purchasingError } from '../../api/purchasing';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner, Status } from '../../components/ui';
import { formatMoney } from '../../lib/orders';
import { PO_STATUSES, STATUS_LABEL, STATUS_TONE, progressText, shortDate, supplierLabel, type PoStatus, type PurchaseOrderSummary } from '../../lib/purchasing';
import './purchasing.css';

/**
 * More -> Purchasing (owner, 2026-10-25): supplier purchase orders. Open ones first; each card shows
 * the supplier, status and how much has arrived. "Reorder suggestions" makes new orders from sales
 * and stock; an order's page sends it, receives the goods (all or part) or cancels it.
 */
type Filter = PoStatus | 'ALL' | 'OPEN';
const FILTERS: Filter[] = ['OPEN', 'ALL', ...PO_STATUSES];

export function Orders() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PurchaseOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const d = await purchasing.list({ status: filter, search: search.trim() || undefined });
      setRows(d.purchase_orders);
      setError(null);
    } catch (err) {
      setError(purchasingError(err, 'Could not load the purchase orders.'));
      setRows([]);
    }
  }, [filter, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  return (
    <div className="page">
      <Link to="/more" className="link">
        ← More
      </Link>
      <PageHeader title="Purchasing" description="Orders to suppliers: send them and receive the goods." />

      <div className="po-bar">
        <Link className="button button--ink" to="/more/purchasing/suggest">
          Reorder suggestions
        </Link>
      </div>
      <div className="po-pills segmented" role="group" aria-label="Status">
        {FILTERS.map((f) => (
          <button key={f} type="button" className={f === filter ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {f === 'OPEN' ? 'Open' : f === 'ALL' ? 'All' : STATUS_LABEL[f]}
          </button>
        ))}
      </div>
      <input className="input po-input" style={{ width: '100%', textAlign: 'left' }} type="search" aria-label="Search orders" placeholder="Order number or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null ? <Spinner label="Loading the purchase orders" /> : null}
      {rows && rows.length === 0 && !error ? <EmptyState title="No purchase orders here" message="Open Reorder suggestions to make one." /> : null}

      {rows && rows.length > 0 ? (
        <ul className="cat-list" aria-label="Purchase orders">
          {rows.map((o) => (
            <li key={o.id}>
              <Link className="po-card" to={`/more/purchasing/${o.id}`} aria-label={`${o.po_number} ${supplierLabel(o.supplier_name)}`}>
                <div className="po-card__head">
                  <p className="po-card__title">
                    {o.po_number} · {supplierLabel(o.supplier_name)}
                  </p>
                  <Status tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Status>
                </div>
                <p className="po-meta">
                  {o.line_count} {o.line_count === 1 ? 'product' : 'products'} · {formatMoney(o.cost_ordered)}
                  {o.status === 'SENT' || o.status === 'PARTIAL' || o.status === 'RECEIVED' ? ` · ${progressText(o)}` : ''}
                </p>
                <p className="po-meta">
                  Made {shortDate(o.created_at)}
                  {o.expected_on ? ` · needed by ${shortDate(o.expected_on)}` : ''}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
