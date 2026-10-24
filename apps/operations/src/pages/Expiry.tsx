import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { expiryApi, expiryErrorMessage, isExpiryNotReady, type BatchBucket, type BatchList, type ExpirySummary, type StockBatch } from '../api/expiry';
import { BatchSheet, DiscardSheet } from '../components/ExpiryDialogs';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Spinner } from '../components/ui';
import '../components/expiry.css';
import { BUCKETS, batchTitle, dayText, severityClass, summaryCount, unitsText } from '../lib/expiry';

/**
 * More -> Expiry (wave 2, 2026-10-25; migration 059), phone-first. What is expired, what expires this week
 * and this month, from the batches staff noted when stock arrived. Each batch has big buttons: Edit, Sold
 * out (it sold through), Discard (throw away; takes it off the stock count, one ledger row). The page opens
 * on the most urgent bucket that has something in it. A batch never hides a product by itself.
 */
export function Expiry() {
  const [summary, setSummary] = useState<ExpirySummary | null>(null);
  const [bucket, setBucket] = useState<BatchBucket | null>(null);
  const [list, setList] = useState<BatchList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StockBatch | null>(null);
  const [soldOut, setSoldOut] = useState<StockBatch | null>(null);
  const [discarding, setDiscarding] = useState<StockBatch | null>(null);
  const [version, setVersion] = useState(0);
  const chosen = useRef(false);

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
        setNotReady(isExpiryNotReady(err));
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
        setNotReady(isExpiryNotReady(err));
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
    setSoldOut(null);
    try {
      await expiryApi.soldOut(batch.id);
      setNotice(`${batchTitle(batch)} marked sold out.`);
    } catch (err) {
      setNotice(expiryErrorMessage(err, 'Could not mark it sold out.'));
    }
    refresh();
  }

  return (
    <div className="page">
      <Link to="/more" className="link">
        ← More
      </Link>
      <PageHeader title="Expiry" description="Stock that is out of date or about to be. Write down each batch when it arrives." />

      <button type="button" className="primary expiry-add" onClick={() => setAdding(true)} disabled={notReady}>
        Add batch
      </button>

      <div className="segmented growth-filters" role="group" aria-label="Show">
        {BUCKETS.map((b) => {
          const n = summaryCount(summary, b.id);
          return (
            <button
              key={b.id}
              type="button"
              className={b.id === bucket ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={b.id === bucket}
              onClick={() => pick(b.id)}
            >
              {b.label}
              {n !== null ? ` ${n}` : ''}
            </button>
          );
        })}
      </div>

      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={notReady ? 'banner' : 'field__error'} role="alert">
          {error}
        </p>
      ) : null}

      {list === null ? (
        <Spinner label="Loading batches" />
      ) : list.batches.length === 0 ? (
        error ? null : (
          <EmptyState
            title={bucket === 'expired' ? 'Nothing has expired' : bucket === 'all' ? 'No batches yet' : 'Nothing expiring in this time'}
            message="Add a batch when stock arrives, with the date printed on the pack."
          />
        )
      ) : (
        <ul className="cat-list" aria-label="Batches">
          {list.batches.map((b) => (
            <li key={b.id} className="card growth-card" aria-label={`${batchTitle(b)}, ${b.label}`}>
              <div className="growth-card__head">
                <div>
                  <p className="growth-card__title">{batchTitle(b)}</p>
                  <p className="growth-card__meta">
                    {unitsText(b.quantity)}
                    {b.batch_code ? ` · batch ${b.batch_code}` : ''}
                    {b.product_sku ? ` · ${b.product_sku}` : ''}
                  </p>
                  {b.note ? <p className="growth-card__meta">{b.note}</p> : null}
                </div>
                <div className="expiry-when">
                  <span className={severityClass(b.severity)}>{b.label}</span>
                  <span className="growth-card__meta">{dayText(b.expires_on)}</span>
                </div>
              </div>
              <div className="growth-card__actions">
                <button type="button" className="button" onClick={() => setEditing(b)} aria-label={`Edit ${batchTitle(b)}`}>
                  Edit
                </button>
                <button type="button" className="button" onClick={() => setSoldOut(b)} aria-label={`Mark ${batchTitle(b)} sold out`}>
                  Sold out
                </button>
                <button type="button" className="button button--danger" onClick={() => setDiscarding(b)} aria-label={`Discard ${batchTitle(b)}`}>
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <BatchSheet
          onClose={() => setAdding(false)}
          onSaved={(message) => {
            setAdding(false);
            setNotice(message);
            refresh();
          }}
        />
      ) : null}
      {editing ? (
        <BatchSheet
          batch={editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setNotice(message);
            refresh();
          }}
        />
      ) : null}
      {soldOut ? (
        <ConfirmDialog
          title="Mark as sold out?"
          message={`${batchTitle(soldOut)} (${unitsText(soldOut.quantity)}) sold through. It leaves this list. The stock count does not change.`}
          confirmLabel="Mark sold out"
          onConfirm={() => void markSoldOut(soldOut)}
          onCancel={() => setSoldOut(null)}
        />
      ) : null}
      {discarding ? (
        <DiscardSheet
          batch={discarding}
          onClose={() => setDiscarding(null)}
          onDone={(message) => {
            setDiscarding(null);
            setNotice(message);
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}
