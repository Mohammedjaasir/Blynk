import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { purchasing, purchasingError, type SupplierOption } from '../api/purchasing';
import { OrderEditor, editorBody, emptyEditor, type EditorValue } from '../components/PurchaseOrderEditor';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Spinner, useToast } from '../components/ui';
import { formatMoney } from '../lib/orders';
import { PO_STATUSES, STATUS_LABEL, STATUS_TONE, progressText, shortDate, supplierLabel, type PoStatus, type PurchaseOrderSummary } from '../lib/purchasing';
import './purchasing.css';

/**
 * Purchase orders (owner, 2026-10-25; GET /admin/purchase-orders): every order to a supplier with
 * its status chip - Draft, Sent, Partly received, Received, Cancelled. Open one to edit a draft,
 * send or copy it, receive the goods (all or part) or cancel it. "New order" builds one by hand;
 * Reorder suggestions makes them from sales and stock.
 */
type Filter = PoStatus | 'ALL' | 'OPEN';
const FILTERS: Filter[] = ['OPEN', 'ALL', ...PO_STATUSES];

export function PurchaseOrders() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<PurchaseOrderSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const d = await purchasing.list({ status: filter, search: search.trim() || undefined });
      setRows(d.purchase_orders);
      setTotal(d.total);
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
    <>
      <PageHeader
        title="Purchase orders"
        description="Orders to suppliers: send them, receive the goods (all or part) and see what is still coming."
        actions={
          <>
            <Link className="button button--ghost" to="/reorder-suggestions">
              Reorder suggestions
            </Link>
            <Link className="button" to="/purchase-orders/new">
              New order
            </Link>
          </>
        }
      />

      <div className="po-toolbar">
        <div className="segmented" role="group" aria-label="Status">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={f === filter ? 'segmented__item is-selected' : 'segmented__item'} aria-pressed={f === filter} onClick={() => setFilter(f)}>
              {f === 'OPEN' ? 'Open' : f === 'ALL' ? 'All' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>
        <input className="input" type="search" aria-label="Search orders" placeholder="Order number or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null ? <Spinner label="Loading the purchase orders" /> : null}
      {rows && rows.length === 0 && !error ? (
        <EmptyState title="No purchase orders here" message="Make one from Reorder suggestions, or press New order." />
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="table-wrap">
          <table className="table" aria-label="Purchase orders">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Supplier</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Products
                </th>
                <th scope="col">Received</th>
                <th scope="col" className="num">
                  Cost
                </th>
                <th scope="col">Needed by</th>
                <th scope="col">Made</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/purchase-orders/${o.id}`} className="mono">
                      {o.po_number}
                    </Link>
                  </td>
                  <td>{supplierLabel(o.supplier_name)}</td>
                  <td>
                    <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                  </td>
                  <td className="num mono">{o.line_count}</td>
                  <td>{o.status === 'DRAFT' || o.status === 'CANCELLED' ? '' : progressText(o)}</td>
                  <td className="num mono">{formatMoney(o.cost_ordered)}</td>
                  <td>{shortDate(o.expected_on)}</td>
                  <td>{shortDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length ? <p className="cell__secondary">Showing the newest {rows.length} of {total}. Search to find an older one.</p> : null}
        </div>
      ) : null}
    </>
  );
}

/** New order by hand: supplier, day, note and product lines; it is saved as a DRAFT. */
export function NewPurchaseOrder() {
  const toast = useToast();
  const navigate = useNavigate();
  const [value, setValue] = useState<EditorValue>(emptyEditor);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    purchasing
      .suppliers()
      .then(setSuppliers)
      .catch(() => undefined);
  }, []);

  async function save() {
    const parsed = editorBody(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const po = await purchasing.create(parsed.body);
      toast.success(`Draft ${po.po_number} created.`);
      navigate(`/purchase-orders/${po.id}`);
    } catch (err) {
      setError(purchasingError(err, 'Could not create the order.'));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New purchase order"
        description="Choose the supplier and the products. It is saved as a draft; send it from the order page."
        actions={
          <Link className="button button--ghost" to="/purchase-orders">
            Back
          </Link>
        }
      />
      <OrderEditor value={value} onChange={setValue} suppliers={suppliers} />
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <p>
        <button type="button" className="button" disabled={busy} onClick={() => void save()}>
          Save draft
        </button>
      </p>
    </>
  );
}
