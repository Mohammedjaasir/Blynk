import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { purchasing, purchasingError, type SupplierOption } from '../api/purchasing';
import { OrderEditor, editorBody, type EditorValue } from '../components/PurchaseOrderEditor';
import { PageHeader } from '../components/Layout';
import { Badge, Field, Spinner, useToast } from '../components/ui';
import { whatsappUrl } from '../lib/insights';
import { formatMoney } from '../lib/orders';
import {
  STATUS_LABEL,
  STATUS_TONE,
  canCancel,
  canEditLines,
  canReceive,
  canSend,
  hasShareText,
  progressText,
  receiveBody,
  receiveDefaults,
  shortDate,
  supplierLabel,
  type PurchaseOrder,
  type ReceiveEntry,
  type ReceiveResult,
} from '../lib/purchasing';
import './purchasing.css';

/**
 * One purchase order: its lines and what has arrived, the text to send the supplier (copy or
 * WhatsApp), and the actions for its status - edit a draft, mark it sent, receive the goods (all or
 * part: stock is added through the stock ledger and the order goes Partly received / Received) or
 * cancel it with a reason.
 */
export function PurchaseOrderView() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [mode, setMode] = useState<'view' | 'edit' | 'receive' | 'cancel'>('view');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<EditorValue | null>(null);
  const [entries, setEntries] = useState<Record<string, ReceiveEntry>>({});
  const [closeShort, setCloseShort] = useState(false);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<ReceiveResult | null>(null);

  const load = useCallback(async () => {
    try {
      setPo(await purchasing.get(id));
      setError(null);
    } catch (err) {
      setError(purchasingError(err, 'Could not load this purchase order.'));
    }
  }, [id]);

  useEffect(() => {
    void load();
    purchasing
      .suppliers()
      .then(setSuppliers)
      .catch(() => undefined);
  }, [load]);

  function open(next: 'edit' | 'receive' | 'cancel') {
    if (!po) return;
    setFormError(null);
    if (next === 'edit') {
      setEditor({
        supplier_id: po.supplier_id ?? '',
        expected_on: po.expected_on ?? '',
        notes: po.notes ?? '',
        lines: po.lines.map((l) => ({ key: `${l.product_id}:${l.variant_id ?? ''}`, product_id: l.product_id, variant_id: l.variant_id, name: l.name, qty: String(l.ordered_qty), cost: l.unit_cost.toFixed(2) })),
      });
    }
    if (next === 'receive') {
      setEntries(receiveDefaults(po));
      setCloseShort(false);
      setResult(null);
    }
    setMode(next);
  }

  async function run<T>(fn: () => Promise<T>, failure: string): Promise<T | undefined> {
    setBusy(true);
    setFormError(null);
    try {
      return await fn();
    } catch (err) {
      setFormError(purchasingError(err, failure));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editor) return;
    const parsed = editorBody(editor);
    if (!parsed.ok) return setFormError(parsed.error);
    const next = await run(() => purchasing.update(id, parsed.body), 'Could not save the order.');
    if (next) {
      setPo(next);
      setMode('view');
      toast.success('Order saved.');
    }
  }

  async function send() {
    const out = await run(() => purchasing.send(id), 'Could not mark the order as sent.');
    if (out) {
      setPo(out.purchase_order);
      toast.success(`${out.purchase_order.po_number} marked as sent. Copy the text or use WhatsApp.`);
    }
  }

  async function receive() {
    if (!po) return;
    const parsed = receiveBody(po, entries, closeShort);
    if (!parsed.ok) return setFormError(parsed.error);
    const out = await run(() => purchasing.receive(id, parsed.body), 'Could not receive the goods.');
    if (out) {
      setPo(out.purchase_order);
      setResult(out);
      setMode('view');
      toast.success(out.purchase_order.status === 'RECEIVED' ? 'Order received in full.' : 'Goods received. The rest is still coming.');
    }
  }

  async function cancel() {
    const next = await run(() => purchasing.cancel(id, reason.trim()), 'Could not cancel the order.');
    if (next) {
      setPo(next);
      setMode('view');
      setReason('');
      toast.success('Order cancelled.');
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Order text copied.');
    } catch {
      toast.error('Could not copy. Select the text and copy it.');
    }
  }

  if (error) {
    return (
      <>
        <PageHeader title="Purchase order" actions={<Link className="button button--ghost" to="/purchase-orders">Back</Link>} />
        <p className="field__error" role="alert">
          {error}
        </p>
      </>
    );
  }
  if (!po) return <Spinner label="Loading the purchase order" />;

  const setEntry = (lineId: string, patch: Partial<ReceiveEntry>) => setEntries((e) => ({ ...e, [lineId]: { ...e[lineId]!, ...patch } }));

  return (
    <>
      <PageHeader
        title={po.po_number}
        description={`Order for ${supplierLabel(po.supplier_name)}`}
        actions={
          <>
            <Link className="button button--ghost" to="/purchase-orders">
              All orders
            </Link>
            {canEditLines(po.status) && mode !== 'edit' ? (
              <button type="button" className="button button--ghost" onClick={() => open('edit')}>
                Edit order
              </button>
            ) : null}
            {canSend(po.status) ? (
              <button type="button" className="button" disabled={busy} onClick={() => void send()}>
                Mark as sent
              </button>
            ) : null}
            {canReceive(po.status) && mode !== 'receive' ? (
              <button type="button" className="button" onClick={() => open('receive')}>
                Receive goods
              </button>
            ) : null}
            {canCancel(po.status) && mode !== 'cancel' ? (
              <button type="button" className="button button--ghost" onClick={() => open('cancel')}>
                Cancel order
              </button>
            ) : null}
          </>
        }
      />

      <div className="po-head">
        <div className="po-head__row">
          <Badge tone={STATUS_TONE[po.status]}>{STATUS_LABEL[po.status]}</Badge>
          {po.supplier_phone ? <span className="cell__secondary">{po.supplier_phone}</span> : null}
          {po.expected_on ? <span>Needed by {shortDate(po.expected_on)}</span> : null}
          {po.status !== 'DRAFT' && po.status !== 'CANCELLED' ? <span>{progressText(po.totals)}</span> : null}
          <span className="mono">{formatMoney(po.totals.cost_ordered)}</span>
        </div>
        <p className="cell__secondary">
          Made {shortDate(po.created_at)}
          {po.created_by_name ? ` by ${po.created_by_name}` : ''}
          {po.sent_at ? ` · sent ${shortDate(po.sent_at)}` : ''}
          {po.received_at ? ` · closed ${shortDate(po.received_at)}` : ''}
        </p>
        {po.notes ? <p>Note: {po.notes}</p> : null}
        {po.status === 'CANCELLED' ? <p className="field__error">Cancelled{po.cancel_reason ? `: ${po.cancel_reason}` : ''}</p> : null}
      </div>

      {result && result.skipped.length > 0 ? (
        <div className="po-panel" role="status">
          {result.skipped.map((s) => (
            <p key={s.item_id} className="po-note po-note--warn">
              {s.name}: {s.note}
            </p>
          ))}
        </div>
      ) : null}

      {mode === 'edit' && editor ? (
        <>
          <OrderEditor value={editor} onChange={setEditor} suppliers={suppliers} />
          {formError ? <p className="field__error" role="alert">{formError}</p> : null}
          <p>
            <button type="button" className="button" disabled={busy} onClick={() => void saveEdit()}>
              Save changes
            </button>{' '}
            <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
              Discard
            </button>
          </p>
        </>
      ) : (
        <div className="table-wrap">
          <table className="table po-lines" aria-label="Order lines">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">Ordered</th>
                <th scope="col" className="num">Received</th>
                {mode === 'receive' ? (
                  <>
                    <th scope="col" className="num">Arrived now</th>
                    <th scope="col" className="num">Cost each paid</th>
                    <th scope="col">Update product cost</th>
                  </>
                ) : (
                  <>
                    <th scope="col" className="num">Cost each</th>
                    <th scope="col" className="num">Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => {
                const e = entries[l.id];
                return (
                  <tr key={l.id} className={l.received_qty > 0 && l.received_qty < l.ordered_qty ? 'is-short' : undefined}>
                    <td>
                      {l.name}
                      {l.unit ? <span className="cell__secondary"> · {l.unit}</span> : null}
                      {l.note ? <p className="po-note">{l.note}</p> : null}
                      {!l.stock_counted ? <p className="po-note po-note--warn">Stock is not counted for this product, so receiving adds no stock.</p> : null}
                    </td>
                    <td className="num mono">{l.ordered_qty}</td>
                    <td className="num mono">{l.received_qty}</td>
                    {mode === 'receive' && e ? (
                      <>
                        <td className="num">
                          <input className="input input--qty" inputMode="numeric" aria-label={`${l.name} arrived now`} value={e.qty} onChange={(ev) => setEntry(l.id, { qty: ev.target.value.replace(/\D/g, '') })} />
                        </td>
                        <td className="num">
                          <input className="input input--cost" inputMode="decimal" aria-label={`${l.name} cost paid`} value={e.cost} onChange={(ev) => setEntry(l.id, { cost: ev.target.value })} />
                        </td>
                        <td>
                          <label>
                            <input type="checkbox" aria-label={`Update cost of ${l.name}`} checked={e.updateCost} onChange={(ev) => setEntry(l.id, { updateCost: ev.target.checked })} /> Make this its cost
                          </label>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="num mono">{formatMoney(l.unit_cost)}</td>
                        <td className="num mono">{formatMoney(l.line_total)}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'receive' ? (
        <div className="po-panel">
          <p className="po-note">Enter what arrived today (0 for a product that did not come). Stock is added for counted products; the order stays open until everything has arrived.</p>
          <label>
            <input type="checkbox" checked={closeShort} onChange={(e) => setCloseShort(e.target.checked)} /> Close the order even if some products are short
          </label>
          {formError ? <p className="field__error" role="alert">{formError}</p> : null}
          <div>
            <button type="button" className="button" disabled={busy} onClick={() => void receive()}>
              Receive
            </button>{' '}
            <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'cancel' ? (
        <div className="po-panel">
          <Field label="Why is it cancelled?">
            <input className="input" aria-label="Cancel reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {formError ? <p className="field__error" role="alert">{formError}</p> : null}
          <div>
            <button type="button" className="button button--danger" disabled={busy || reason.trim() === ''} onClick={() => void cancel()}>
              Cancel this order
            </button>{' '}
            <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
              Keep it
            </button>
          </div>
        </div>
      ) : null}

      {hasShareText(po.status) && mode !== 'edit' ? (
        <section className="po-panel" aria-label="Text for the supplier">
          <h2 className="purchase-group__name">Send to the supplier</h2>
          <pre className="po-share">{po.share.text}</pre>
          <div>
            <button type="button" className="button button--ghost button--sm" onClick={() => void copy(po.share.text)}>
              Copy
            </button>{' '}
            <a className="button button--sm purchase-whatsapp" href={po.share.whatsapp_url ?? whatsappUrl(po.share.text, null)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </div>
          {po.share.whatsapp_url === null ? <p className="po-note">The supplier has no phone number saved, so WhatsApp asks who to send it to.</p> : null}
        </section>
      ) : null}
    </>
  );
}
