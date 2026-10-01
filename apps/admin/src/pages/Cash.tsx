import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { cash as cashApi, riders as ridersApi } from '../api/resources';
import type { CashHandin, CashReconciliation, ReconciliationStatus, RiderOption } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { colomboDate } from '../lib/coupons';
import { formatMoney } from '../lib/orders';

/**
 * Rider cash (backend migration 019). Riders collect cash on delivery;
 * staff record what each rider hands in. Per rider and Sri Lanka day:
 * collected (settled deliveries), handed in, and the difference - short
 * in red, over in amber.
 */

const errorText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

export function differenceText(difference: number, status: ReconciliationStatus): string {
  if (status === 'BALANCED') return 'Balanced';
  return `${status === 'SHORT' ? 'Short' : 'Over'} ${formatMoney(Math.abs(difference))}`;
}

export function Cash() {
  const toast = useToast();
  const [date, setDate] = useState(() => colomboDate());
  const [data, setData] = useState<CashReconciliation | null>(null);
  const [handins, setHandins] = useState<CashHandin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ riderId?: string } | null>(null);
  const [deleting, setDeleting] = useState<CashHandin | null>(null);

  const load = useCallback(async () => {
    setData(null);
    try {
      const [recon, list] = await Promise.all([cashApi.reconciliation(date), cashApi.handins(date)]);
      setData(recon);
      setHandins(list);
      setError(null);
    } catch (err) {
      setError(errorText(err, 'Could not load cash.'));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(h: CashHandin) {
    setDeleting(null);
    try {
      await cashApi.remove(h.id);
      toast.success('Hand-in deleted.');
      await load();
    } catch (err) {
      toast.error(errorText(err, 'Could not delete the hand-in.'));
    }
  }

  return (
    <>
      <PageHeader
        title="Rider cash"
        description="Cash each rider collected against what they handed in, per Sri Lanka day."
        actions={
          <>
            <input
              className="input"
              type="date"
              aria-label="Day"
              value={date}
              max={colomboDate()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
            <button type="button" className="button" onClick={() => setRecording({})}>
              Record hand-in
            </button>
          </>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}
      {!data && !error ? <Spinner label="Loading cash" /> : null}

      {data ? (
        data.riders.length === 0 ? (
          <EmptyState title="No cash this day" message="No rider collected or handed in cash on this day." />
        ) : (
          <div className="table-wrap">
            <table className="table" aria-label="Cash by rider">
              <thead>
                <tr>
                  <th scope="col">Rider</th>
                  <th scope="col" className="num">
                    Deliveries
                  </th>
                  <th scope="col" className="num">
                    Collected
                  </th>
                  <th scope="col" className="num">
                    Handed in
                  </th>
                  <th scope="col">Difference</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.riders.map((r) => (
                  <tr key={r.rider_id} className={`cash-row cash-row--${r.status.toLowerCase()}`}>
                    <td className="cell__primary">{r.rider_name ?? 'Rider'}</td>
                    <td className="num mono">{r.deliveries}</td>
                    <td className="num mono">{formatMoney(r.collected)}</td>
                    <td className="num mono">{formatMoney(r.handed_in)}</td>
                    <td>
                      <span className={`cash-diff cash-diff--${r.status.toLowerCase()}`}>{differenceText(r.difference, r.status)}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost button--sm"
                        aria-label={`Record hand-in for ${r.rider_name ?? 'rider'}`}
                        onClick={() => setRecording({ riderId: r.rider_id })}
                      >
                        Record
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">All riders</th>
                  <td />
                  <td className="num mono">{formatMoney(data.totals.collected)}</td>
                  <td className="num mono">{formatMoney(data.totals.handed_in)}</td>
                  <td>
                    <span className={`cash-diff cash-diff--${data.totals.status.toLowerCase()}`}>
                      {differenceText(data.totals.difference, data.totals.status)}
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : null}

      {data && handins.length > 0 ? (
        <section className="attention">
          <h2 className="section-label">Hand-ins this day</h2>
          <ul className="attention__list" aria-label="Hand-ins">
            {handins.map((h) => (
              <li key={h.id} className="attention__item">
                <span>
                  <strong>{h.rider_name ?? 'Rider'}</strong> handed in <span className="mono">{formatMoney(h.amount)}</span>
                  {h.note ? ` – ${h.note}` : ''}
                  {h.recorded_by_name ? <span className="cell__secondary"> · recorded by {h.recorded_by_name}</span> : null}
                </span>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  aria-label={`Delete hand-in of ${formatMoney(h.amount)}`}
                  onClick={() => setDeleting(h)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recording ? (
        <HandinDialog
          date={date}
          riderId={recording.riderId}
          onClose={() => setRecording(null)}
          onSaved={async (h) => {
            setRecording(null);
            toast.success(`${formatMoney(h.amount)} from ${h.rider_name ?? 'the rider'} recorded.`);
            if (h.handin_date !== date) setDate(h.handin_date);
            else await load();
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete hand-in"
          message={`Delete ${formatMoney(deleting.amount)} from ${deleting.rider_name ?? 'this rider'}? Record it again if the amount was wrong.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void remove(deleting)}
        />
      ) : null}
    </>
  );
}

function HandinDialog({
  date,
  riderId,
  onClose,
  onSaved,
}: {
  date: string;
  riderId?: string;
  onClose(): void;
  onSaved(h: CashHandin): void;
}) {
  const [riders, setRiders] = useState<RiderOption[] | null>(null);
  const [rider, setRider] = useState(riderId ?? '');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(date);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'rider' | 'amount' | 'day' | 'form', string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    ridersApi
      .listActive()
      .then(setRiders)
      .catch(() => setRiders([]));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    const value = Number(amount);
    if (!rider) next.rider = 'Choose the rider.';
    if (!(amount.trim() && value > 0)) next.amount = 'Enter the amount handed in.';
    if (!day || day > colomboDate()) next.day = 'Choose today or an earlier day.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      onSaved(await cashApi.record({ rider_id: rider, amount: Number(value.toFixed(2)), handin_date: day, note: note.trim() || undefined }));
    } catch (err) {
      setErrors({ form: errorText(err, 'Could not record the hand-in.') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Record hand-in">
      <form className="modal__panel" onSubmit={submit} noValidate>
        <h2 className="modal__title">Record hand-in</h2>
        <Field label="Rider" error={errors.rider}>
          <select className="input" value={rider} onChange={(e) => setRider(e.target.value)} disabled={riders === null}>
            <option value="">{riders === null ? 'Loading riders…' : 'Choose a rider'}</option>
            {(riders ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name ?? r.phone}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (LKR)" error={errors.amount}>
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Day" error={errors.day}>
          <input className="input" type="date" value={day} max={colomboDate()} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Note" hint="Optional.">
          <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {errors.form ? <p className="field__error">{errors.form}</p> : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Record'}
          </button>
        </div>
      </form>
    </div>
  );
}
