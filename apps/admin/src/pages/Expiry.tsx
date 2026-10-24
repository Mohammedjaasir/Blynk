import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  expiryApi,
  expiryErrorMessage,
  type BatchBucket,
  type BatchList,
  type ExpirySummary,
  type StockBatch,
} from '../api/expiry';
import { ExpiryBatchDialog } from '../components/ExpiryBatchDialog';
import { PageHeader } from '../components/Layout';
import { Switch } from '../components/Switch';
import { ConfirmDialog, EmptyState, Spinner, useToast } from '../components/ui';
import { BUCKETS, batchTitle, dayText, discardedText, severityClass, summaryCount, unitsText } from '../lib/expiry';
import './expiry.css';

/**
 * Expiry (wave 2, 2026-10-25; migration 059). What is expired, what expires this week and this month, from
 * the batches staff wrote down when stock arrived. "Sold out" closes a batch that sold through; "Discard"
 * throws the rest away and takes it off the stock count (one ledger row). Batches are a register: an expired
 * batch never hides a product by itself.
 */
export function Expiry() {
  const toast = useToast();
  const [summary, setSummary] = useState<ExpirySummary | null>(null);
  const [bucket, setBucket] = useState<BatchBucket | null>(null);
  const [list, setList] = useState<BatchList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StockBatch | null>(null);
  const [soldOut, setSoldOut] = useState<StockBatch | null>(null);
  const [discarding, setDiscarding] = useState<StockBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = useRef(false);
  const [version, setVersion] = useState(0);

  // the most urgent bucket with something in it, until the person picks one
  useEffect(() => {
    let live = true;
    expiryApi
      .summary()
      .then((s) => {
        if (!live) return;
        setSummary(s);
        if (!chosen.current) setBucket(s.expired.batches > 0 ? 'expired' : s.week.batches > 0 ? 'week' : s.month.batches > 0 ? 'month' : 'all');
      })
      .catch((err) => {
        if (!live) return;
        setError(expiryErrorMessage(err, 'Could not load the expiry summary.'));
        setBucket((b) => b ?? 'all');
      });
    return () => {
      live = false;
    };
  }, [version]);

  useEffect(() => {
    if (!bucket) return;
    let live = true;
    setList(null);
    expiryApi
      .list({ bucket })
      .then((l) => {
        if (!live) return;
        setList(l);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        setError(expiryErrorMessage(err, 'Could not load the batches.'));
        setList({ today: '', batches: [], total: 0, page: 1, limit: 0 });
      });
    return () => {
      live = false;
    };
  }, [bucket, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const pick = (b: BatchBucket) => {
    chosen.current = true;
    setBucket(b);
  };

  async function markSoldOut(batch: StockBatch) {
    setBusy(true);
    try {
      await expiryApi.soldOut(batch.id);
      toast.success(`${batchTitle(batch)} marked sold out.`);
      setSoldOut(null);
      refresh();
    } catch (err) {
      toast.error(expiryErrorMessage(err, 'Could not mark it sold out.'));
      setSoldOut(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Expiry"
        description="Stock that is out of date or about to be. Write down each batch when it arrives."
        actions={
          <button type="button" className="button" onClick={() => setAdding(true)}>
            Add batch
          </button>
        }
      />

      <div className="segmented expiry-tabs" role="group" aria-label="Show">
        {BUCKETS.map((b) => {
          const n = summaryCount(summary, b.id);
          return (
            <button
              key={b.id}
              type="button"
              className={b.id === bucket ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={b.id === bucket}
              title={b.hint}
              onClick={() => pick(b.id)}
            >
              {b.label}
              {n !== null ? <span className="expiry-tabs__count"> {n}</span> : null}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {list === null ? (
        <Spinner label="Loading batches" />
      ) : list.batches.length === 0 ? (
        <EmptyState
          title={bucket === 'expired' ? 'Nothing has expired' : bucket === 'all' ? 'No batches yet' : 'Nothing expiring in this time'}
          message="Add a batch when stock arrives, with the date printed on the pack."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Batch</th>
                <th className="num">How many</th>
                <th>Expires</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link className="link" to={`/products/${b.product_id}`}>
                      {batchTitle(b)}
                    </Link>
                    {b.product_sku ? <div className="cell__secondary">{b.product_sku}</div> : null}
                    {b.note ? <div className="cell__secondary">{b.note}</div> : null}
                  </td>
                  <td>{b.batch_code ?? <span className="cell__secondary">-</span>}</td>
                  <td className="num mono">{b.quantity}</td>
                  <td>
                    <span className={severityClass(b.severity)}>{b.label}</span>
                    <div className="cell__secondary">{dayText(b.expires_on)}</div>
                  </td>
                  <td>
                    <div className="expiry-actions">
                      <button type="button" className="button button--ghost button--sm" onClick={() => setEditing(b)} aria-label={`Edit ${batchTitle(b)}`}>
                        Edit
                      </button>
                      <button type="button" className="button button--ghost button--sm" onClick={() => setSoldOut(b)} aria-label={`Mark ${batchTitle(b)} sold out`}>
                        Sold out
                      </button>
                      <button type="button" className="button button--danger button--sm" onClick={() => setDiscarding(b)} aria-label={`Discard ${batchTitle(b)}`}>
                        Discard
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <ExpiryBatchDialog
          onClose={() => setAdding(false)}
          onSaved={(message) => {
            setAdding(false);
            toast.success(message);
            refresh();
          }}
        />
      ) : null}
      {editing ? (
        <ExpiryBatchDialog
          batch={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            toast.success(message);
            refresh();
          }}
        />
      ) : null}
      {soldOut ? (
        <ConfirmDialog
          title="Mark as sold out?"
          message={`${batchTitle(soldOut)} (${unitsText(soldOut.quantity)}, ${soldOut.label.toLowerCase()}) sold through. It leaves this list. The stock count does not change.`}
          confirmLabel={busy ? 'Saving...' : 'Mark sold out'}
          onConfirm={() => void markSoldOut(soldOut)}
          onCancel={() => setSoldOut(null)}
        />
      ) : null}
      {discarding ? (
        <DiscardDialog
          batch={discarding}
          onClose={() => setDiscarding(null)}
          onDone={(message) => {
            setDiscarding(null);
            toast.success(message);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function DiscardDialog({ batch, onClose, onDone }: { batch: StockBatch; onClose(): void; onDone(message: string): void }) {
  const [reason, setReason] = useState<'EXPIRED' | 'WASTE'>(batch.severity === 'expired' ? 'EXPIRED' : 'WASTE');
  const [reduce, setReduce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await expiryApi.discard(batch.id, { reason, reduce_stock: reduce });
      onDone(discardedText(batchTitle(batch), res.stock_removed));
    } catch (err) {
      setError(expiryErrorMessage(err, 'Could not discard the batch.'));
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Discard batch">
      <div className="modal__panel expiry-dialog">
        <h2 className="modal__title">{`Discard ${batchTitle(batch)}?`}</h2>
        <p className="modal__message">
          {`${unitsText(batch.quantity)} (${batch.label.toLowerCase()}, ${dayText(batch.expires_on)}) will be thrown away and the batch closed. This cannot be undone.`}
        </p>
        <div className="field">
          <span className="field__label" id="discard-reason-label">
            Why
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="discard-reason-label">
            {(['EXPIRED', 'WASTE'] as const).map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                className={reason === r ? 'segmented__item is-selected' : 'segmented__item'}
                onClick={() => setReason(r)}
              >
                {r === 'EXPIRED' ? 'Expired' : 'Waste (damaged / spoiled)'}
              </button>
            ))}
          </div>
        </div>
        <Switch checked={reduce} onChange={setReduce} label="Take it off the stock count">
          Take it off the stock count
        </Switch>
        <p className="form__note">
          {reduce
            ? 'The stock count goes down by the same number, as a write-off in the stock history (never below zero).'
            : 'Only the batch is closed. Use this if you already corrected the stock count by hand.'}
        </p>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button button--danger" onClick={() => void go()} disabled={busy}>
            {busy ? 'Discarding...' : 'Discard batch'}
          </button>
        </div>
      </div>
    </div>
  );
}
