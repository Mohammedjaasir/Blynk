import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deliveriesApi } from '../api/resources';
import type { Delivery, DeliveryLine, DeliveryStatus } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, LoadError, Spinner, Status, type Tone, useToast } from '../components/ui';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import { notifyStockChanged } from '../lib/stock';
import { useLoad } from '../lib/useLoad';

/**
 * Supplier deliveries (owner, 2026-10-25: "Packing staff can't open purchase orders yet"). Purchase
 * orders that were sent to a supplier and can be received, and the screen where packing staff type
 * what actually arrived. No prices anywhere: the API sends none to packing staff, and nothing here
 * would show or send a cost. Stock goes up through the same ledger as every other restock.
 */
export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  DRAFT: 'Not sent yet',
  SENT: 'On order',
  PARTIAL: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

const DELIVERY_STATUS_TONE: Record<DeliveryStatus, Tone> = {
  DRAFT: 'muted',
  SENT: 'warn',
  PARTIAL: 'info',
  RECEIVED: 'ok',
  CANCELLED: 'bad',
};

const canReceive = (status: DeliveryStatus) => status === 'SENT' || status === 'PARTIAL';

/** What is still to come on a line; the default for "Arrived now". */
export const outstanding = (line: Pick<DeliveryLine, 'ordered_qty' | 'received_qty' | 'remaining_qty'>) =>
  Math.max(0, line.remaining_qty ?? line.ordered_qty - line.received_qty);

export function Deliveries() {
  const { data, error, loading, reload } = useLoad(() => deliveriesApi.list(), []);
  const orders = data?.purchase_orders ?? [];

  return (
    <>
      <PageHeader
        title="Deliveries"
        description="Orders sent to suppliers that are waiting for goods. Open one when the delivery arrives and enter what came."
        actions={
          <button type="button" className="button button--ghost" onClick={() => void reload()} disabled={loading}>
            {loading && data ? <Spinner label="Refreshing" /> : 'Refresh'}
          </button>
        }
      />

      {error ? <LoadError error={error} onRetry={() => void reload()} /> : null}
      {loading && !data ? <Spinner label="Loading deliveries" /> : null}

      {data && orders.length === 0 ? (
        <EmptyState title="No deliveries are waiting" message="Nothing has been ordered from a supplier that is still to arrive." />
      ) : null}

      {orders.length > 0 ? (
        <div className="table-wrap">
          <table className="table" aria-label="Deliveries waiting">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Supplier</th>
                <th scope="col">Status</th>
                <th scope="col" className="col-secondary">
                  Expected
                </th>
                <th scope="col" className="num">
                  Units arrived
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((po) => (
                <tr key={po.id}>
                  <td>
                    <Link className="attention-list__name mono" to={`/deliveries/${po.id}`}>
                      {po.po_number}
                    </Link>
                    <span className="cell__secondary">
                      {po.line_count} {po.line_count === 1 ? 'product' : 'products'}
                    </span>
                  </td>
                  <td>{po.supplier_name ?? <span className="cell__secondary">No supplier named</span>}</td>
                  <td>
                    <Status tone={DELIVERY_STATUS_TONE[po.status]}>{DELIVERY_STATUS_LABEL[po.status]}</Status>
                  </td>
                  <td className="col-secondary">{po.expected_on ? formatDate(po.expected_on) : '—'}</td>
                  <td className="num mono">
                    {po.units_received} / {po.units_ordered}
                  </td>
                  <td className="nowrap">
                    <Link className="text-link" to={`/deliveries/${po.id}`} aria-label={`Receive ${po.po_number}`}>
                      Receive →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

type Notice = { kind: 'ok' | 'bad'; text: string };

/** Quantity typed in a field -> a whole number >= 0, or null when it is not one. */
export function parseQty(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  return Number(t);
}

export function DeliveryDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { data: po, error, loading, reload } = useLoad(() => deliveriesApi.detail(id), [id]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [closeShort, setCloseShort] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Every (re)load starts each line at what is still outstanding.
  useEffect(() => {
    if (!po) return;
    setQty(Object.fromEntries(po.lines.map((l) => [l.id, String(outstanding(l))])));
    setCloseShort(false);
  }, [po]);

  const receivable = po ? canReceive(po.status) : false;

  /** The typed figures as the API wants them, or why they cannot be sent. */
  function parsed(order: Delivery): { lines: { item_id: string; received_qty: number }[]; units: number } | string {
    const lines: { item_id: string; received_qty: number }[] = [];
    let units = 0;
    for (const l of order.lines) {
      const n = parseQty(qty[l.id] ?? '');
      if (n === null) return `Enter a whole number for ${l.name} (0 if none came).`;
      lines.push({ item_id: l.id, received_qty: n });
      units += n;
    }
    if (units === 0 && !closeShort) return 'Enter what arrived for at least one product.';
    return { lines, units };
  }

  function review() {
    if (!po) return;
    const result = parsed(po);
    if (typeof result === 'string') {
      setFormError(result);
      return;
    }
    setFormError(null);
    setDialogError(null);
    setConfirming(true);
  }

  async function confirm() {
    if (!po) return;
    const result = parsed(po);
    if (typeof result === 'string') {
      setConfirming(false);
      setFormError(result);
      return;
    }
    setBusy(true);
    setDialogError(null);
    try {
      const out = await deliveriesApi.receive(po.id, { lines: result.lines, close_short: closeShort || undefined });
      const closed = out.purchase_order.status === 'RECEIVED';
      const skipped = out.skipped.map((s) => s.name);
      toast.success(`${po.po_number}: delivery recorded.`);
      setNotice({
        kind: 'ok',
        text:
          `Delivery recorded for ${po.po_number}: ${result.units} ${result.units === 1 ? 'unit' : 'units'} added. ` +
          (closed ? 'The order is closed.' : 'The rest is still to come.') +
          (skipped.length ? ` Stock is not counted for ${skipped.join(', ')}, so none was added for it.` : ''),
      });
      setConfirming(false);
      notifyStockChanged();
      await reload();
    } catch (err) {
      // Someone else received or cancelled it first: explain on the page and show the latest.
      if (err instanceof ApiError && err.status === 409) {
        setNotice({ kind: 'bad', text: `${po.po_number}: ${errorMessage(err)} Showing the latest.` });
        setConfirming(false);
        await reload();
        return;
      }
      setDialogError(errorMessage(err, 'The delivery was not recorded.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !po) {
    return (
      <>
        <PageHeader title="Delivery" actions={<Link className="text-link" to="/deliveries">← All deliveries</Link>} />
        <LoadError error={error} onRetry={() => void reload()} />
      </>
    );
  }
  if (!po) {
    return loading ? <Spinner label="Loading the delivery" /> : null;
  }

  const totalUnits = po.lines.reduce((n, l) => n + (parseQty(qty[l.id] ?? '') ?? 0), 0);

  return (
    <>
      <PageHeader
        title={po.po_number}
        description={
          <>
            {po.supplier_name ?? 'No supplier named'}
            {po.expected_on ? ` · expected ${formatDate(po.expected_on)}` : ''}
          </>
        }
        actions={
          <Link className="text-link" to="/deliveries">
            ← All deliveries
          </Link>
        }
      />

      {notice ? (
        <div className={`notice ${notice.kind === 'bad' ? 'notice--bad' : 'notice--ok'}`} role={notice.kind === 'bad' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button type="button" className="button button--ghost button--sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {error ? <LoadError error={error} onRetry={() => void reload()} /> : null}

      <p className="delivery-status">
        <Status tone={DELIVERY_STATUS_TONE[po.status]}>{DELIVERY_STATUS_LABEL[po.status]}</Status>
        {po.received_at ? <span className="cell__secondary">Closed {formatDate(po.received_at)}</span> : null}
      </p>
      {po.notes ? <p className="delivery-notes">{po.notes}</p> : null}
      {po.status === 'DRAFT' ? (
        <div className="notice notice--warn" role="status">
          <span>This order has not been sent to the supplier yet, so it cannot be received.</span>
        </div>
      ) : null}
      {po.status === 'CANCELLED' || po.status === 'RECEIVED' ? (
        <div className="notice notice--warn" role="status">
          <span>{po.status === 'RECEIVED' ? 'This order is closed. Nothing more can be received on it.' : 'This order was cancelled.'}</span>
        </div>
      ) : null}

      <div className="table-wrap">
        <table className="table delivery-lines" aria-label="Products on this order">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col" className="num">
                Ordered
              </th>
              <th scope="col" className="num">
                Already in
              </th>
              {receivable ? (
                <th scope="col" className="num">
                  Arrived now
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.name}
                  {l.unit ? <span className="cell__secondary">{l.unit}</span> : null}
                  {l.note ? <span className="cell__secondary">{l.note}</span> : null}
                  {receivable && !l.stock_counted ? (
                    <span className="cell__secondary">Stock is not counted for this product, so receiving adds no stock.</span>
                  ) : null}
                </td>
                <td className="num mono">{l.ordered_qty}</td>
                <td className="num mono">{l.received_qty}</td>
                {receivable ? (
                  <td className="num">
                    <input
                      className="input delivery-qty"
                      inputMode="numeric"
                      aria-label={`${l.name} arrived now`}
                      value={qty[l.id] ?? ''}
                      onChange={(e) => setQty((all) => ({ ...all, [l.id]: e.target.value.replace(/\D/g, '') }))}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {receivable ? (
        <div className="delivery-panel">
          <p className="delivery-help">
            Type what actually arrived (0 for a product that did not come). Stock goes up for counted products; the order stays open
            until everything has arrived.
          </p>
          <label className="check">
            <input type="checkbox" checked={closeShort} onChange={(e) => setCloseShort(e.target.checked)} /> Close short (the
            supplier will not send the rest)
          </label>
          {formError ? (
            <p className="field__error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="delivery-actions">
            <button type="button" className="button" onClick={review} disabled={busy}>
              Confirm delivery
            </button>
          </div>
        </div>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title="Confirm delivery"
          confirmLabel="Add to stock"
          busy={busy}
          error={dialogError}
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        >
          <p>
            Add {totalUnits} {totalUnits === 1 ? 'unit' : 'units'} from {po.po_number} to stock?
          </p>
          {closeShort ? <p>The order will be closed even if some products are short.</p> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
