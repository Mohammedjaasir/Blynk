import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { dental } from '../../api/resources';
import type { DoctorAvailability, DoctorBlockedDate } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { ConfirmDialog, EmptyState, Field, Spinner } from '../../components/ui';
import { dentalErrorMessage, formatBlockedDate } from '../../lib/dental';

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * One clinic-doctor pairing's weekly availability template and blocked
 * dates (task F8, plan §18-19). Ported from
 * `apps/admin/src/pages/DentalAvailability.tsx` (a fresh implementation,
 * not an import) - combined into one screen exactly as the reference
 * implementation does (both sub-domains key off the same `clinic_doctor_id`
 * and are managed together in the reviewed Admin page), rather than the
 * brief's own suggested `Availability.tsx`/`BlockedDates.tsx` file split,
 * which this task's own "or your own equivalent decomposition - document
 * it" clause explicitly permits.
 *
 * The cross-entity "outside clinic operating hours" rejection
 * (`400 TEMPLATE_OUTSIDE_CLINIC_HOURS`) is surfaced with the backend's own
 * message, which names both windows - this screen never re-derives or
 * second-guesses it (task-F8-brief.md's explicit instruction).
 */
export function Availability() {
  const { clinicDoctorId } = useParams<{ clinicDoctorId: string }>();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { doctorName?: string; clinicName?: string } };

  const [rows, setRows] = useState<DoctorAvailability[] | null>(null);
  const [blockedDates, setBlockedDates] = useState<DoctorBlockedDate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [addingBlock, setAddingBlock] = useState(false);
  const [deletingRow, setDeletingRow] = useState<DoctorAvailability | null>(null);
  const [unblocking, setUnblocking] = useState<DoctorBlockedDate | null>(null);

  const load = useCallback(async () => {
    if (!clinicDoctorId) return;
    try {
      const [availability, blocks] = await Promise.all([
        dental.availability.list(clinicDoctorId),
        dental.blockedDates.list(clinicDoctorId),
      ]);
      setRows(availability);
      setBlockedDates(blocks);
      setError(null);
    } catch (err) {
      setError(dentalErrorMessage(err));
      setRows([]);
      setBlockedDates([]);
    }
  }, [clinicDoctorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function deleteRow(row: DoctorAvailability) {
    try {
      await dental.availability.remove(row.id);
      setNotice('Availability row removed.');
      setDeletingRow(null);
      await load();
    } catch (err) {
      setNotice(dentalErrorMessage(err));
      setDeletingRow(null);
    }
  }

  async function removeBlock(block: DoctorBlockedDate) {
    try {
      await dental.blockedDates.remove(block.id);
      setNotice('Date unblocked.');
      setUnblocking(null);
      await load();
    } catch (err) {
      setNotice(dentalErrorMessage(err));
      setUnblocking(null);
    }
  }

  if (!clinicDoctorId) return null;

  const heading = location.state?.doctorName
    ? `${location.state.doctorName}${location.state.clinicName ? ` at ${location.state.clinicName}` : ''}`
    : 'Availability';

  return (
    <div className="page">
      <PageHeader
        title={heading}
        description="Weekly availability template and blocked dates for this clinic-doctor pairing."
        actions={
          <button type="button" className="button button--ghost" onClick={() => navigate(-1)}>
            Back
          </button>
        }
      />

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      <section className="form__section">
        <h2 className="form__section-title">Weekly template</h2>
        {rows === null ? (
          <Spinner label="Loading template" />
        ) : rows.length === 0 ? (
          <EmptyState title="No weekly availability set up yet" />
        ) : (
          <ul className="cat-list">
            {rows.map((row) => (
              <li key={row.id} className="cat-row cat-row--flat">
                <div className="cat-row__main">
                  <p className="cat-row__title">{DAY_LABELS[row.day_of_week]}</p>
                  <p className="cat-row__meta">
                    {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
                  </p>
                  <p className="cat-row__meta">
                    {row.slot_duration_minutes} min slots · {row.buffer_minutes} min buffer
                  </p>
                </div>
                <div className="cat-row__actions">
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => setDeletingRow(row)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="actions-row">
          <button type="button" className="button" onClick={() => setAddingRow(true)}>
            Add availability row
          </button>
        </div>
      </section>

      <section className="form__section">
        <h2 className="form__section-title">Blocked dates</h2>
        {blockedDates === null ? (
          <Spinner label="Loading blocked dates" />
        ) : blockedDates.length === 0 ? (
          <EmptyState title="No blocked dates for this doctor at this clinic" />
        ) : (
          <ul className="cat-list">
            {blockedDates.map((block) => (
              <li key={block.id} className="cat-row cat-row--flat">
                <div className="cat-row__main">
                  <p className="cat-row__title">{formatBlockedDate(block.blocked_date)}</p>
                  <p className="cat-row__meta">{block.reason}</p>
                </div>
                <div className="cat-row__actions">
                  <button
                    type="button"
                    className="button button--ghost button--sm"
                    onClick={() => setUnblocking(block)}
                  >
                    Unblock
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="actions-row">
          <button type="button" className="button" onClick={() => setAddingBlock(true)}>
            Block a date
          </button>
        </div>
      </section>

      {addingRow ? (
        <AvailabilityDialog
          clinicDoctorId={clinicDoctorId}
          onClose={() => setAddingRow(false)}
          onSaved={async () => {
            setAddingRow(false);
            await load();
          }}
        />
      ) : null}

      {addingBlock ? (
        <BlockedDateDialog
          clinicDoctorId={clinicDoctorId}
          onClose={() => setAddingBlock(false)}
          onSaved={async () => {
            setAddingBlock(false);
            await load();
          }}
        />
      ) : null}

      {deletingRow ? (
        <ConfirmDialog
          title="Remove availability row"
          message={`${DAY_LABELS[deletingRow.day_of_week]} ${deletingRow.start_time.slice(0, 5)}–${deletingRow.end_time.slice(0, 5)} will no longer be bookable. This cannot be undone.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => void deleteRow(deletingRow)}
          onCancel={() => setDeletingRow(null)}
        />
      ) : null}

      {unblocking ? (
        <ConfirmDialog
          title="Unblock date"
          message={`${formatBlockedDate(unblocking.blocked_date)} becomes bookable again for this doctor at this clinic.`}
          confirmLabel="Unblock"
          onConfirm={() => void removeBlock(unblocking)}
          onCancel={() => setUnblocking(null)}
        />
      ) : null}
    </div>
  );
}

interface AvailabilityFormState {
  day_of_week: string;
  start_time: string;
  end_time: string;
  slot_duration_minutes: string;
  buffer_minutes: string;
}

function AvailabilityDialog({
  clinicDoctorId,
  onClose,
  onSaved,
}: {
  clinicDoctorId: string;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [form, setForm] = useState<AvailabilityFormState>({
    day_of_week: '1',
    start_time: '09:00',
    end_time: '17:00',
    slot_duration_minutes: '30',
    buffer_minutes: '0',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (form.end_time <= form.start_time) next.end_time = 'End time must be after start time.';
    const duration = Number(form.slot_duration_minutes);
    if (!Number.isInteger(duration) || duration <= 0) {
      next.slot_duration_minutes = 'Enter a positive number of minutes.';
    }
    const buffer = Number(form.buffer_minutes);
    if (!Number.isInteger(buffer) || buffer < 0) next.buffer_minutes = 'Enter zero or more minutes.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setSaving(true);
    try {
      await dental.availability.create(clinicDoctorId, {
        day_of_week: Number(form.day_of_week),
        start_time: form.start_time,
        end_time: form.end_time,
        slot_duration_minutes: Number(form.slot_duration_minutes),
        buffer_minutes: Number(form.buffer_minutes),
      });
      await onSaved();
    } catch (err) {
      // task-F8-brief.md: the "outside clinic operating hours" rejection is
      // the one cross-entity check the admin must clearly understand, not
      // just see as a generic failure - the backend's own message names
      // both windows, so it's shown verbatim.
      setServerError(dentalErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add availability">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Add availability</h2>
        <Field label="Day of week">
          <select
            className="input"
            value={form.day_of_week}
            onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}
          >
            {DAY_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <div className="form__row">
          <Field label="Start time">
            <input
              className="input"
              type="time"
              value={form.start_time}
              onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            />
          </Field>
          <Field label="End time" error={errors.end_time}>
            <input
              className="input"
              type="time"
              value={form.end_time}
              onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            />
          </Field>
        </div>
        <div className="form__row">
          <Field label="Slot duration (minutes)" error={errors.slot_duration_minutes}>
            <input
              className="input"
              inputMode="numeric"
              value={form.slot_duration_minutes}
              onChange={(e) => setForm({ ...form, slot_duration_minutes: e.target.value })}
            />
          </Field>
          <Field label="Buffer (minutes)" hint="Gap kept after each slot" error={errors.buffer_minutes}>
            <input
              className="input"
              inputMode="numeric"
              value={form.buffer_minutes}
              onChange={(e) => setForm({ ...form, buffer_minutes: e.target.value })}
            />
          </Field>
        </div>
        {serverError ? (
          <p className="field__error" role="alert">
            {serverError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

function BlockedDateDialog({
  clinicDoctorId,
  onClose,
  onSaved,
}: {
  clinicDoctorId: string;
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!date) {
      setError('Choose a date.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required.');
      return;
    }

    setSaving(true);
    try {
      await dental.blockedDates.create(clinicDoctorId, { blocked_date: date, reason: reason.trim() });
      await onSaved();
    } catch (err) {
      setError(dentalErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Block a date">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Block a date</h2>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Reason">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? <Spinner label="Saving" /> : 'Block date'}
          </button>
        </div>
      </form>
    </div>
  );
}
