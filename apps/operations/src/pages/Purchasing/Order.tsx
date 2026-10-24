import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { purchasing, purchasingError } from '../../api/purchasing';
import { PageHeader } from '../../components/Layout';
import { Spinner, Status } from '../../components/ui';
import { whatsappUrl } from '../../lib/insights';
import { formatMoney } from '../../lib/orders';
import {
  STATUS_LABEL,
  STATUS_TONE,
  canCancel,
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
} from '../../lib/purchasing';
import './purchasing.css';

/**
 * One purchase order on the phone (owner, 2026-10-25): mark a draft as sent and share the text
 * (copy or WhatsApp), receive the goods - all or part, stock is added for counted products - or
 * cancel it with a reason. Editing the products of a draft is done in Admin.
 */
export function Order() {
  const { id = '' } = useParams();
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'receive' | 'cancel'>('view');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Record<string, ReceiveEntry>>({});
  const [closeShort, setCloseShort] = useState(false);
  const [reason, setReason] = useState('');
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
  }, [load]);

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

  async function send() {
    const out = await run(() => purchasing.send(id), 'Could not mark the order as sent.');
    if (out) {
      setPo(out.purchase_order);
      setNotice(`${out.purchase_order.po_number} marked as sent. Copy the text or use WhatsApp.`);
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
      setNotice(out.purchase_order.status === 'RECEIVED' ? 'Order received in full.' : 'Goods received. The rest is still coming.');
    }
  }

  async function cancel() {
    const next = await run(() => purchasing.cancel(id, reason.trim()), 'Could not cancel the order.');
    if (next) {
      setPo(next);
      setMode('view');
      setReason('');
      setNotice('Order cancelled.');
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Order text copied.');
    } catch {
      setNotice('Could not copy on this phone. Use WhatsApp instead.');
    }
  }

  if (error) {
    return (
      <div className="page">
        <Link to="/more/purchasing" className="link">
          ← Purchasing
        </Link>
        <p className="field__error" role="alert">
          {error}
        </p>
      </div>
    );
  }
  if (!po) return <Spinner label="Loading the purchase order" />;

  const setEntry = (lineId: string, patch: Partial<ReceiveEntry>) => setEntries((e) => ({ ...e, [lineId]: { ...e[lineId]!, ...patch } }));

  return (
    <div className="page">
      <Link to="/more/purchasing" className="link">
        ← Purchasing
      </Link>
      <PageHeader title={po.po_number} description={`Order for ${supplierLabel(po.supplier_name)}`} />

      <section className="card">
        <div className="po-card__head">
          <Status tone={STATUS_TONE[po.status]}>{STATUS_LABEL[po.status]}</Status>
          <span className="po-card__title">{formatMoney(po.totals.cost_ordered)}</span>
        </div>
        {po.status !== 'DRAFT' && po.status !== 'CANCELLED' ? <p className="po-meta">{progressText(po.totals)}</p> : null}
        <p className="po-meta">
          Made {shortDate(po.created_at)}
          {po.expected_on ? ` · needed by ${shortDate(po.expected_on)}` : ''}
          {po.sent_at ? ` · sent ${shortDate(po.sent_at)}` : ''}
        </p>
        {po.notes ? <p>Note: {po.notes}</p> : null}
        {po.status === 'CANCELLED' ? <p className="field__error">Cancelled{po.cancel_reason ? `: ${po.cancel_reason}` : ''}</p> : null}
      </section>

      {notice ? (
        <p className="po-created" role="status">
          {notice}
        </p>
      ) : null}
      {result && result.skipped.length > 0 ? (
        <section className="card" role="status">
          {result.skipped.map((s) => (
            <p key={s.item_id} className="po-meta po-meta--warn">
              {s.name}: {s.note}
            </p>
          ))}
        </section>
      ) : null}

      <section className="card" aria-label="Order lines">
        {po.lines.map((l) => {
          const e = entries[l.id];
          return (
            <div key={l.id} className="po-row" style={{ gridTemplateColumns: '1fr' }}>
              <div className="po-row__body">
                <p className="po-card__title">{l.name}</p>
                <p className="po-meta">
                  Ordered {l.ordered_qty} · received {l.received_qty} · {formatMoney(l.unit_cost)} each
                </p>
                {!l.stock_counted ? <p className="po-meta po-meta--warn">Stock is not counted for this product, so receiving adds no stock.</p> : null}
                {mode === 'receive' && e ? (
                  <div className="po-row__line">
                    <label className="po-meta">
                      Arrived now{' '}
                      <input className="input po-input" inputMode="numeric" aria-label={`${l.name} arrived now`} value={e.qty} onChange={(ev) => setEntry(l.id, { qty: ev.target.value.replace(/\D/g, '') })} />
                    </label>
                    <label className="po-meta">
                      Cost paid{' '}
                      <input className="input po-input" inputMode="decimal" aria-label={`${l.name} cost paid`} value={e.cost} onChange={(ev) => setEntry(l.id, { cost: ev.target.value })} />
                    </label>
                    <label className="po-meta">
                      <input type="checkbox" aria-label={`Update cost of ${l.name}`} checked={e.updateCost} onChange={(ev) => setEntry(l.id, { updateCost: ev.target.checked })} /> Make this its cost
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>

      {mode === 'receive' ? (
        <section className="card">
          <p className="po-meta">Enter what arrived today (0 for a product that did not come). The order stays open until everything has arrived.</p>
          <label>
            <input type="checkbox" checked={closeShort} onChange={(e) => setCloseShort(e.target.checked)} /> Close the order even if some products are short
          </label>
          {formError ? (
            <p className="field__error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="po-actions">
            <button type="button" className="button button--ink" disabled={busy} onClick={() => void receive()}>
              Receive
            </button>
            <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
              Close
            </button>
          </div>
        </section>
      ) : null}

      {mode === 'cancel' ? (
        <section className="card">
          <input className="input" aria-label="Cancel reason" placeholder="Why is it cancelled?" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          {formError ? (
            <p className="field__error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="po-actions">
            <button type="button" className="button button--danger" disabled={busy || reason.trim() === ''} onClick={() => void cancel()}>
              Cancel this order
            </button>
            <button type="button" className="button button--ghost" onClick={() => setMode('view')}>
              Keep it
            </button>
          </div>
        </section>
      ) : null}

      {mode === 'view' ? (
        <div className="po-actions">
          {canSend(po.status) ? (
            <button type="button" className="button button--ink" disabled={busy} onClick={() => void send()}>
              Mark as sent
            </button>
          ) : null}
          {canReceive(po.status) ? (
            <button
              type="button"
              className="button button--ink"
              onClick={() => {
                setEntries(receiveDefaults(po));
                setCloseShort(false);
                setResult(null);
                setFormError(null);
                setMode('receive');
              }}
            >
              Receive goods
            </button>
          ) : null}
          {canCancel(po.status) ? (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setFormError(null);
                setMode('cancel');
              }}
            >
              Cancel order
            </button>
          ) : null}
        </div>
      ) : null}
      {mode === 'view' && formError ? (
        <p className="field__error" role="alert">
          {formError}
        </p>
      ) : null}

      {hasShareText(po.status) ? (
        <section className="card" aria-label="Text for the supplier">
          <p className="po-card__title">Send to the supplier</p>
          <pre className="po-share">{po.share.text}</pre>
          <div className="po-actions">
            <button type="button" className="button button--ghost" onClick={() => void copy(po.share.text)}>
              Copy
            </button>
            <a className="button po-whatsapp" href={po.share.whatsapp_url ?? whatsappUrl(po.share.text, null)} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
