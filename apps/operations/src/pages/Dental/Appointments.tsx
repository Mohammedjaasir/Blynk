import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { dental } from '../../api/resources';
import {
  DENTAL_APPOINTMENT_STATUSES,
  type AdminAppointment,
  type DentalAppointmentStatus,
  type DentalClinic,
  type DentalDoctor,
} from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, EmptyState, Field, Spinner } from '../../components/ui';
import { dentalErrorMessage, specialtyLabel } from '../../lib/dental';
import { formatMoney } from '../../lib/orders';

/**
 * Admin appointment list + admin-cancel (task F9, plan §20). Read for
 * convention from `apps/admin/src/pages/DentalAppointments.tsx` (a fresh
 * implementation, not an import - common.md rule 2): the same filters,
 * status display and cancel-dialog shape, ported onto this app's own
 * mobile-first `cat-list`/`cat-row` list convention (Ledger.tsx/Clinics.tsx)
 * instead of Admin's desktop `<table>` - Operations has no `.table`/
 * `.table-wrap` CSS anywhere (checked before writing this), and common.md
 * rule 14 explicitly forbids Admin's dashboard-squeezed-onto-a-phone look.
 *
 * One deliberate addition beyond Admin's own reference screen: patient
 * notes are rendered per row (Admin's table has no notes column) - the
 * brief explicitly lists patient name/phone/**notes** as operationally
 * necessary and already backend-exposed, so this task adds it rather than
 * silently matching Admin's narrower table.
 */

const STATUS_LABEL: Record<DentalAppointmentStatus, string> = {
  HELD: 'Held',
  EXPIRED: 'Expired',
  CONFIRMED: 'Confirmed',
  CANCELLED_BY_CUSTOMER: 'Cancelled by customer',
  CANCELLED_BY_CLINIC: 'Cancelled by clinic',
};

/** Mirrors `assertCancellable` (backend/api/src/modules/dental/
 * appointment.service.ts) exactly, verified directly against that source
 * rather than guessed from the brief (its own instruction): every status
 * except the two terminal cancelled statuses and `EXPIRED` - i.e. `HELD` or
 * `CONFIRMED` only. Same list Admin's own reference page uses. */
const CANCELLABLE_STATUSES: DentalAppointmentStatus[] = ['HELD', 'CONFIRMED'];

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Colombo',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const formatDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso));

/** `YYYY-MM-DD` in Asia/Colombo - the same offset trick Home.tsx's own
 * `colomboDateString` uses for this identical endpoint's `from`/`to` (a
 * fresh copy here, not shared - every Operations page keeps its own small
 * copy, the pattern Home/Orders already established). */
function todayColombo(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * B4's DTO marks a stale HELD row `is_expired_hold: true` without ever
 * rewriting `status` - this reads that flag rather than status alone, so an
 * expired-but-unreclaimed hold looks visibly different from a live one
 * instead of an indistinguishable active hold (the brief's explicit "never
 * as an indistinguishable active hold" instruction).
 */
function statusDisplay(row: AdminAppointment): { label: string; tone: 'active' | 'inactive' | 'muted' } {
  if (row.status === 'HELD' && row.is_expired_hold) return { label: 'Hold expired', tone: 'inactive' };
  if (row.status === 'HELD') return { label: 'Held', tone: 'muted' };
  if (row.status === 'CONFIRMED') return { label: 'Confirmed', tone: 'active' };
  return { label: STATUS_LABEL[row.status], tone: 'inactive' };
}

interface Filters {
  clinicId: string;
  doctorId: string;
  status: DentalAppointmentStatus | '';
  from: string;
  to: string;
}

/** Default view (brief: "at minimum: today's appointments, upcoming
 * appointments") - `from` = today, Asia/Colombo, `to` left open-ended so
 * every future appointment is included too. "Show all" (below) drops back
 * to no date bound at all, i.e. every appointment ever, past included. */
function defaultFilters(): Filters {
  return { clinicId: '', doctorId: '', status: '', from: todayColombo(), to: '' };
}
const EMPTY_FILTERS: Filters = { clinicId: '', doctorId: '', status: '', from: '', to: '' };

export function Appointments() {
  const [defaults] = useState<Filters>(defaultFilters);
  const [clinics, setClinics] = useState<DentalClinic[]>([]);
  const [doctors, setDoctors] = useState<DentalDoctor[]>([]);
  const [filters, setFilters] = useState<Filters>(defaults);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<AdminAppointment[] | null>(null);
  const [pagination, setPagination] = useState<{ page: number; limit: number; total: number; total_pages: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<AdminAppointment | null>(null);

  useEffect(() => {
    void dental.clinics.list().then(setClinics).catch(() => setClinics([]));
    void dental.doctors.list().then(setDoctors).catch(() => setDoctors([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await dental.appointments.list({
        clinic_id: filters.clinicId || undefined,
        doctor_id: filters.doctorId || undefined,
        status: filters.status || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        page,
        limit: 20,
      });
      setRows(result.appointments);
      setPagination(result.pagination);
      setError(null);
    } catch (err) {
      setError(dentalErrorMessage(err));
      setRows([]);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function showAll() {
    setPage(1);
    setFilters(EMPTY_FILTERS);
  }

  async function submitCancel(reason: string) {
    if (!cancelling) return;
    try {
      await dental.appointments.cancel(cancelling.id, reason);
      setNotice('Appointment cancelled.');
      setCancelling(null);
      await load();
    } catch (err) {
      setNotice(dentalErrorMessage(err));
    }
  }

  const isFiltered =
    filters.clinicId !== defaults.clinicId ||
    filters.doctorId !== defaults.doctorId ||
    filters.status !== defaults.status ||
    filters.from !== defaults.from ||
    filters.to !== defaults.to;

  return (
    <div className="page">
      <PageHeader
        title="Appointments"
        description="Today's and upcoming appointments across every clinic, plus cancellations."
      />

      <div className="filters">
        <select
          className="input"
          value={filters.clinicId}
          onChange={(e) => updateFilter('clinicId', e.target.value)}
          aria-label="Filter by clinic"
        >
          <option value="">All clinics</option>
          {clinics.map((clinic) => (
            <option key={clinic.id} value={clinic.id}>
              {clinic.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={filters.doctorId}
          onChange={(e) => updateFilter('doctorId', e.target.value)}
          aria-label="Filter by doctor"
        >
          <option value="">All doctors</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctor.full_name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value as DentalAppointmentStatus | '')}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {DENTAL_APPOINTMENT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>
        <div className="form__row">
          <label className="field">
            <span className="field__label">From</span>
            <input
              className="input"
              type="date"
              value={filters.from}
              onChange={(e) => updateFilter('from', e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">To</span>
            <input className="input" type="date" value={filters.to} onChange={(e) => updateFilter('to', e.target.value)} />
          </label>
        </div>
        {isFiltered ? (
          <button type="button" className="button button--ghost button--sm" onClick={showAll}>
            Show all appointments
          </button>
        ) : null}
      </div>

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading appointments" />
      ) : rows.length === 0 ? (
        <EmptyState title="No appointments match" message="Try a different filter or date range." />
      ) : (
        <ul className="cat-list">
          {rows.map((row) => {
            const status = statusDisplay(row);
            return (
              <li key={row.id} className="cat-row cat-row--flat">
                <div className="cat-row__main">
                  <p className="cat-row__title">{row.patient_name ?? 'Unnamed patient'}</p>
                  <p className="cat-row__meta">{row.patient_phone ?? 'No phone on file'}</p>
                  {row.patient_notes ? <p className="cat-row__meta">Notes: {row.patient_notes}</p> : null}
                  <p className="cat-row__meta">
                    {row.clinic.name} · {row.doctor.full_name} ({specialtyLabel(row.doctor.specialty)})
                  </p>
                  <p className="cat-row__meta">{formatDateTime(row.start_at)}</p>
                  <p className="cat-row__meta">
                    {row.consultation_fee_snapshot === null
                      ? 'No fee recorded'
                      : `${formatMoney(row.consultation_fee_snapshot)} · indicative, payable at the clinic`}
                  </p>
                  <div className="cat-row__badges">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                </div>
                <div className="cat-row__actions">
                  {CANCELLABLE_STATUSES.includes(row.status) ? (
                    <button type="button" className="button button--ghost button--sm" onClick={() => setCancelling(row)}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pagination && pagination.total_pages > 1 ? (
        <nav className="filters" aria-label="Pages">
          <span className="page__note">
            Page {pagination.page} of {pagination.total_pages} · {pagination.total} total
          </span>
          <div className="actions-row">
            <button
              type="button"
              className="button button--ghost button--sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="button button--ghost button--sm"
              disabled={pagination.page >= pagination.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </nav>
      ) : null}

      {cancelling ? <CancelDialog appointment={cancelling} onClose={() => setCancelling(null)} onConfirm={submitCancel} /> : null}
    </div>
  );
}

function CancelDialog({
  appointment,
  onClose,
  onConfirm,
}: {
  appointment: AdminAppointment;
  onClose(): void;
  onConfirm(reason: string): void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Courtesy-only client-side block: the real requirement is enforced
    // server-side (`adminCancelAppointmentSchema`'s `min(1)`) regardless of
    // what this check does.
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onConfirm(trimmed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Cancel appointment">
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Cancel appointment</h2>
        <p className="modal__message">
          {appointment.patient_name ?? 'This patient'} at {appointment.clinic.name} with {appointment.doctor.full_name},{' '}
          {formatDateTime(appointment.start_at)}. This cannot be undone.
        </p>
        <Field label="Reason — shown to the customer">
          <textarea
            className="input"
            rows={3}
            maxLength={255}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Back
          </button>
          <button type="submit" className="button button--danger" disabled={!trimmed || busy}>
            {busy ? 'Cancelling…' : 'Cancel appointment'}
          </button>
        </div>
      </form>
    </div>
  );
}
