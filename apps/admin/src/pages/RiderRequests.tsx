import { useCallback, useEffect, useState } from 'react';
import { riderApplications } from '../api/resources';
import type { RiderApplication, RiderApprovalStatus } from '../api/types';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';

/**
 * Rider requests (migration 029). New riders apply in the Rider app; an Admin
 * (or Operations, in their app) approves or rejects them here. An approved
 * rider gets an SMS and can then sign in with their phone number.
 */

const TABS: { status: RiderApprovalStatus; label: string }[] = [
  { status: 'PENDING', label: 'Waiting' },
  { status: 'APPROVED', label: 'Approved' },
  { status: 'REJECTED', label: 'Rejected' },
];

export const VEHICLE_LABEL: Record<string, string> = {
  MOTORCYCLE: 'Motorcycle',
  SCOOTER: 'Scooter',
  BICYCLE: 'Bicycle',
  THREE_WHEELER: 'Three-wheeler',
  CAR: 'Car',
};

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});
const fmt = (iso: string | null) => (iso ? when.format(new Date(iso)) : '—');

/** "+94771234567" -> "077 123 4567". */
export const readablePhone = (phone: string | null) => {
  if (!phone) return '—';
  const local = phone.startsWith('+94') ? `0${phone.slice(3)}` : phone;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
};

const REASON_MAX = 500;

export function RiderRequests() {
  const toast = useToast();
  const [status, setStatus] = useState<RiderApprovalStatus>('PENDING');
  const [rows, setRows] = useState<RiderApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<RiderApplication | null>(null);
  const [rejecting, setRejecting] = useState<RiderApplication | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const page = await riderApplications.list(status);
      setRows(page.applications);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load rider requests.'));
      setRows([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(app: RiderApplication) {
    setBusy(true);
    try {
      await riderApplications.approve(app.id);
      toast.success(`${app.full_name ?? 'The rider'} is approved and gets an SMS to sign in.`);
      setApproving(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not approve the rider.'));
    } finally {
      setBusy(false);
    }
  }

  async function reject(app: RiderApplication) {
    const text = reason.trim();
    if (!text) return;
    setBusy(true);
    try {
      await riderApplications.reject(app.id, text);
      toast.success(`${app.full_name ?? 'The application'} was rejected.`);
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reject the application.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Rider requests"
        description="Riders apply in the Blynk Rider app. Approve them here; they get an SMS and sign in with their phone number."
        actions={
          <div className="segmented" role="group" aria-label="Show">
            {TABS.map((tab) => (
              <button
                key={tab.status}
                type="button"
                className={tab.status === status ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={tab.status === status}
                onClick={() => setStatus(tab.status)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading rider requests" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState
            title={status === 'PENDING' ? 'No rider requests waiting' : status === 'APPROVED' ? 'No approved riders yet' : 'No rejected requests'}
            message={status === 'PENDING' ? 'New applications from the Rider app appear here.' : undefined}
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Rider requests">
            <thead>
              <tr>
                <th scope="col">Rider</th>
                <th scope="col">Phone</th>
                <th scope="col">Vehicle</th>
                <th scope="col">Applied</th>
                {status === 'PENDING' ? <th scope="col">Decision</th> : <th scope="col">Reviewed</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <tr key={app.id}>
                  <td>
                    <div className="cell__primary">{app.full_name ?? '—'}</div>
                    {app.emergency_contact_phone ? (
                      <div className="cell__secondary">Emergency: {readablePhone(app.emergency_contact_phone)}</div>
                    ) : null}
                  </td>
                  <td className="mono">{readablePhone(app.phone)}</td>
                  <td>
                    {VEHICLE_LABEL[app.vehicle_type] ?? app.vehicle_type}
                    {app.vehicle_registration_number ? <div className="cell__secondary mono">{app.vehicle_registration_number}</div> : null}
                  </td>
                  <td>{fmt(app.applied_at)}</td>
                  {status === 'PENDING' ? (
                    <td>
                      <div className="row-actions">
                        <button type="button" className="button button--sm" onClick={() => setApproving(app)}>
                          Approve
                        </button>
                        <button
                          type="button"
                          className="button button--sm button--ghost"
                          onClick={() => {
                            setReason('');
                            setRejecting(app);
                          }}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  ) : (
                    <td>
                      {fmt(app.reviewed_at)}
                      {app.reviewed_by_name ? <div className="cell__secondary">by {app.reviewed_by_name}</div> : null}
                      {app.rejection_reason ? <div className="cell__secondary">Reason: {app.rejection_reason}</div> : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approving ? (
        <ConfirmDialog
          title="Approve this rider?"
          message={`${approving.full_name ?? 'This rider'} (${readablePhone(approving.phone)}) can then sign in to the Rider app and receive deliveries. They get an SMS.`}
          confirmLabel={busy ? 'Approving…' : 'Approve'}
          onConfirm={() => void (busy ? undefined : approve(approving))}
          onCancel={() => setApproving(null)}
        />
      ) : null}

      {rejecting ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Reject rider request">
          <div className="modal__panel">
            <h2 className="modal__title">Reject {rejecting.full_name ?? 'this request'}?</h2>
            <label className="field">
              <span className="field__label">Reason (sent to the rider)</span>
              <textarea
                id="reject-reason"
                className="input"
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setRejecting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={busy || !reason.trim()}
                onClick={() => void reject(rejecting)}
              >
                {busy ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
