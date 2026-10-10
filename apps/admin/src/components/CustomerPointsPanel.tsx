import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { referralPoints, type CustomerPoints } from '../api/referralPoints';
import { errorMessage } from '../lib/apiErrors';
import { formatDay } from '../lib/coupons';
import { formatClock, shortNumber } from '../lib/orders';
import { MAX_REASON, POINTS_KIND_LABEL, groupNumber, lkr, parseAdjustPoints, parseReason, signedPoints } from '../lib/referralPoints';
import { EmptyState, Field, Spinner, useToast } from './ui';

/**
 * Customers -> one customer -> Blynk Points (owner, 2026-10-10): the
 * balance, what it is worth, every earn/use/refund/expiry/adjustment, and a
 * "+/- adjust" form that needs a reason (the server audits it and refuses to
 * go below 0).
 */
export function CustomerPointsPanel({ customerId }: { customerId: string }) {
  const toast = useToast();
  const [data, setData] = useState<CustomerPoints | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    referralPoints
      .customerPoints(customerId)
      .then((d) => {
        if (cancelled) return;
        // A backend from before points (or a proxy page) answers something
        // else - say so instead of breaking the customer page.
        if (!d || !Array.isArray(d.history) || typeof d.balance !== 'number') {
          setLoadError('Could not load the points.');
          return;
        }
        setData(d);
        setLoadError(null);
      })
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not load the points.')));
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  async function adjust(event: FormEvent) {
    event.preventDefault();
    setSaveError(null);
    const p = parseAdjustPoints(points);
    const r = parseReason(reason);
    setPointsError('error' in p ? p.error : null);
    setReasonError('error' in r ? r.error : null);
    if ('error' in p || 'error' in r) return;
    setSaving(true);
    try {
      setData(await referralPoints.adjustPoints(customerId, { points: p.value, reason: r.value }));
      setPoints('');
      setReason('');
      toast.success(`${signedPoints(p.value)} points saved.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POINTS_INSUFFICIENT') {
        const balance = (err.details as { balance?: number } | undefined)?.balance ?? data?.balance;
        setSaveError(
          balance === undefined
            ? 'That would take the balance below 0.'
            : `That would take the balance below 0 - they have ${groupNumber(balance)} points.`
        );
      } else {
        setSaveError(errorMessage(err, 'Could not adjust the points.'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-label="Blynk Points">
      <h2 className="panel__title">Blynk Points</h2>
      {loadError ? (
        <p className="field__error">{loadError}</p>
      ) : !data ? (
        <Spinner label="Loading the points" />
      ) : (
        <>
          <div className="figures" aria-label="Points figures">
            <div className="figure">
              <span className="figure__value" data-testid="points-balance">
                {groupNumber(data.balance)}
              </span>
              <span className="figure__label">Points</span>
            </div>
            <div className="figure">
              <span className="figure__value figure__value--sm">{lkr(data.value_lkr)}</span>
              <span className="figure__label">Worth</span>
            </div>
          </div>
          {!data.enabled ? <p className="form__note">Blynk Points is off in Settings - customers cannot earn or use points now.</p> : null}

          {data.history.length === 0 ? (
            <EmptyState title="No points yet" />
          ) : (
            <div className="table-wrap">
              <table className="table" aria-label="Points history">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Kind</th>
                    <th scope="col" className="num">
                      Points
                    </th>
                    <th scope="col">Order</th>
                    <th scope="col">Reason</th>
                    <th scope="col">By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id}>
                      <td className="cell__secondary">
                        {formatDay(h.created_at)} {formatClock(h.created_at)}
                      </td>
                      <td>
                        {POINTS_KIND_LABEL[h.kind] ?? h.kind}
                        {h.expires_at && h.points > 0 && h.remaining > 0 ? (
                          <span className="cell__secondary"> · expires {formatDay(h.expires_at)}</span>
                        ) : null}
                      </td>
                      <td className="num mono">{signedPoints(h.points)}</td>
                      <td className="mono">{h.order_number ? `#${shortNumber(h.order_number)}` : '—'}</td>
                      <td>{h.reason ?? <span className="cell__secondary">—</span>}</td>
                      <td className="cell__secondary">{h.actor_name ?? (h.kind === 'ADJUST' ? 'Staff' : 'Blynk')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form className="form" onSubmit={adjust} noValidate aria-label="Change the balance">
            <Field label="Adjust points (+/-)" hint="50 adds points; -50 takes them away. The balance cannot go below 0." error={pointsError ?? undefined}>
              <input className="input" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} />
            </Field>
            <Field label="Reason" hint="Required - shown in the history and the audit log." error={reasonError ?? undefined}>
              <input className="input" maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {saveError ? (
              <p className="field__error" role="alert">
                {saveError}
              </p>
            ) : null}
            <div className="form__actions">
              <button type="submit" className="button" disabled={saving}>
                {saving ? <Spinner label="Saving" /> : 'Adjust points'}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
