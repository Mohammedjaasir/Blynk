import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applicationsErrorMessage, sellerApplications as applicationsApi } from '../api/sellerApplications';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { whenText } from '../lib/engagement';
import {
  APPLICATION_NOTE_MAX,
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  APPLICATION_STATUS_TONE,
  addSellerState,
  applicationCounts,
  localPhone,
  sortApplications,
  telHref,
  type SellerApplication,
  type SellerApplicationStatus,
} from '../lib/sellerApplications';
import './sellers.css';

/**
 * Seller applications (owner's brother, 2026-10-27: "one form inside blynk.lk saying apply for seller
 * registration; once they submit we receive the application, then we contact them directly by
 * phone"). Shops apply at blynk.lk/seller. Staff ring the number, set the application Contacted,
 * Approved or Declined, keep a note, and press "Add as seller" to open the Add seller form with the
 * shop, name and number already filled in. Blynk Ops has the same screen under More.
 */
type Filter = SellerApplicationStatus | 'ALL';

export function SellerApplications() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SellerApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [editing, setEditing] = useState<string | null>(null);

  // Every status is loaded at once, so the filter chips can show their counts.
  const load = useCallback(async () => {
    try {
      const r = await applicationsApi.list();
      setRows(r.applications);
      setError(null);
    } catch (err) {
      setError(applicationsErrorMessage(err, 'Could not load the seller applications.'));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => applicationCounts(rows ?? []), [rows]);
  const shown = useMemo(() => sortApplications((rows ?? []).filter((r) => filter === 'ALL' || r.status === filter)), [rows, filter]);

  return (
    <>
      <PageHeader
        title="Seller applications"
        description="Shops that applied at blynk.lk/seller. Call them on the number they gave, then mark the application and add them as a seller."
      />

      <div className="sellers__bar">
        <div className="segmented" role="group" aria-label="Status">
          {(['ALL', ...APPLICATION_STATUSES] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={f === filter ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f === 'ALL' ? 'All' : APPLICATION_STATUS_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading the seller applications" />
      ) : shown.length === 0 ? (
        error ? null : (
          <EmptyState
            title={rows.length === 0 ? 'No applications yet' : 'No applications here'}
            message={rows.length === 0 ? 'When a shop applies on blynk.lk/seller it appears here, and you get a notification.' : undefined}
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Seller applications">
            <thead>
              <tr>
                <th scope="col">Shop</th>
                <th scope="col">Owner</th>
                <th scope="col">Phone</th>
                <th scope="col">Town</th>
                <th scope="col">What they sell</th>
                <th scope="col">Received</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <Fragment key={a.id}>
                  <tr aria-label={a.shop_name}>
                    <td>
                      <span className="cell__primary">{a.shop_name}</span>
                      {a.email ? (
                        <span className="cell__secondary">
                          <a href={`mailto:${a.email}`}>{a.email}</a>
                        </span>
                      ) : null}
                    </td>
                    <td>{a.owner_name}</td>
                    <td className="mono">
                      <a href={telHref(a.phone)} aria-label={`Call ${a.owner_name} on ${localPhone(a.phone)}`}>
                        {localPhone(a.phone)}
                      </a>
                    </td>
                    <td>{a.town}</td>
                    <td>
                      {a.what_they_sell}
                      {a.message ? <span className="cell__secondary">“{a.message}”</span> : null}
                      {a.staff_note ? <span className="cell__secondary">Note: {a.staff_note}</span> : null}
                    </td>
                    <td>{whenText(a.created_at)}</td>
                    <td>
                      <Badge tone={APPLICATION_STATUS_TONE[a.status] ?? 'muted'}>{APPLICATION_STATUS_LABEL[a.status] ?? a.status}</Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="button button--sm"
                          aria-label={`Add ${a.shop_name} as seller`}
                          onClick={() => navigate('/sellers', { state: addSellerState(a) })}
                        >
                          Add as seller
                        </button>
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          aria-expanded={editing === a.id}
                          aria-label={`Update ${a.shop_name}`}
                          onClick={() => setEditing(editing === a.id ? null : a.id)}
                        >
                          Update
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editing === a.id ? (
                    <tr>
                      <td colSpan={8}>
                        <UpdateForm
                          application={a}
                          onCancel={() => setEditing(null)}
                          onSaved={(saved) => {
                            setEditing(null);
                            setRows((list) => (list ?? []).map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function UpdateForm({
  application: a,
  onSaved,
  onCancel,
}: {
  application: SellerApplication;
  onSaved(saved: SellerApplication): void;
  onCancel(): void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<SellerApplicationStatus>(a.status);
  const [note, setNote] = useState(a.staff_note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = status !== a.status || note.trim() !== (a.staff_note ?? '');

  async function save() {
    if (!changed) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await applicationsApi.update(a.id, {
        ...(status !== a.status ? { status } : {}),
        ...(note.trim() !== (a.staff_note ?? '') ? { staff_note: note.trim() } : {}),
      });
      toast.success(`${a.shop_name} is marked ${APPLICATION_STATUS_LABEL[r.application.status].toLowerCase()}.`);
      onSaved(r.application);
    } catch (err) {
      setError(applicationsErrorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="form"
      aria-label={`Update ${a.shop_name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="segmented" role="group" aria-label="Application status">
        {APPLICATION_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={s === status ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={s === status}
            onClick={() => setStatus(s)}
          >
            {APPLICATION_STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <Field label="Staff note (optional)" hint={`${note.length}/${APPLICATION_NOTE_MAX} · only staff see it`}>
        <textarea className="input" rows={2} maxLength={APPLICATION_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {a.handled_at ? (
        <p className="field__hint">
          Last handled {whenText(a.handled_at)}
          {a.handled_by_name ? ` by ${a.handled_by_name}` : ''}.
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form__actions">
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
