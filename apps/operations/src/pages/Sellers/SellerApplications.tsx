import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { applicationsErrorMessage, sellerApplications as applicationsApi } from '../../api/sellerApplications';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner, Status, type Tone } from '../../components/ui';
import { colomboWhen } from '../../lib/growth';
import {
  APPLICATION_NOTE_MAX,
  APPLICATION_STATUSES,
  APPLICATION_STATUS_LABEL,
  addSellerState,
  applicationCounts,
  localPhone,
  sortApplications,
  telHref,
  type SellerApplication,
  type SellerApplicationStatus,
} from '../../lib/sellerApplications';
import { BackToMore, Sheet, TextField } from './parts';
import './sellers.css';

/**
 * More -> Seller applications (owner's brother, 2026-10-27: "one form inside blynk.lk saying apply for
 * seller registration; once they submit we receive the application, then we contact them directly by
 * phone"). Shops apply at blynk.lk/seller. Ring the number (tap it), set the application Contacted,
 * Approved or Declined, keep a note, and press "Add as seller" to open the Add seller sheet with the
 * shop, name and number already filled in. Admin has the same page.
 */
type Filter = SellerApplicationStatus | 'ALL';

const TONE: Record<SellerApplicationStatus, Tone> = { NEW: 'warn', CONTACTED: 'info', APPROVED: 'ok', DECLINED: 'muted' };

export function SellerApplications() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SellerApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [editing, setEditing] = useState<SellerApplication | null>(null);

  // Every status is loaded at once, so the filter chips can show their counts.
  const load = useCallback(async () => {
    try {
      setRows((await applicationsApi.list()).applications);
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
    <div className="page">
      <BackToMore />
      <PageHeader
        title="Seller applications"
        description="Shops that applied at blynk.lk/seller. Call them on the number they gave, then mark the application and add them as a seller."
      />

      <div className="segmented sellers-filters" role="group" aria-label="Show applications">
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
        <ul className="cat-list" aria-label="Seller applications">
          {shown.map((a) => (
            <li key={a.id} className="card" aria-label={`Application ${a.shop_name}`}>
              <div className="sellers-card__head">
                <p className="sellers-card__title">{a.shop_name}</p>
                <Status tone={TONE[a.status] ?? 'muted'}>{APPLICATION_STATUS_LABEL[a.status] ?? a.status}</Status>
              </div>
              <p className="sellers-card__meta">
                {a.owner_name} ·{' '}
                <a className="mono" href={telHref(a.phone)} aria-label={`Call ${a.owner_name} on ${localPhone(a.phone)}`}>
                  {localPhone(a.phone)}
                </a>
              </p>
              <p className="sellers-card__meta">
                {a.town} · {colomboWhen(a.created_at)}
              </p>
              {a.email ? (
                <p className="sellers-card__meta">
                  <a href={`mailto:${a.email}`}>{a.email}</a>
                </p>
              ) : null}
              <p className="sellers-card__meta">Sells: {a.what_they_sell}</p>
              {a.message ? <p className="sellers-card__meta">“{a.message}”</p> : null}
              {a.staff_note ? <p className="sellers-card__meta">Note: {a.staff_note}</p> : null}
              <div className="sellers-actions">
                <button
                  type="button"
                  className="button button--ink"
                  aria-label={`Add ${a.shop_name} as seller`}
                  onClick={() => navigate('/more/sellers', { state: addSellerState(a) })}
                >
                  Add as seller
                </button>
                <button type="button" className="button" aria-label={`Update ${a.shop_name}`} onClick={() => setEditing(a)}>
                  Update
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <UpdateSheet
          application={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setRows((list) => (list ?? []).map((r) => (r.id === saved.id ? { ...r, ...saved } : r)));
          }}
        />
      ) : null}
    </div>
  );
}

function UpdateSheet({
  application: a,
  onSaved,
  onClose,
}: {
  application: SellerApplication;
  onSaved(saved: SellerApplication): void;
  onClose(): void;
}) {
  const [status, setStatus] = useState<SellerApplicationStatus>(a.status);
  const [note, setNote] = useState(a.staff_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = status !== a.status || note.trim() !== (a.staff_note ?? '');

  async function save() {
    if (!changed) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await applicationsApi.update(a.id, {
        ...(status !== a.status ? { status } : {}),
        ...(note.trim() !== (a.staff_note ?? '') ? { staff_note: note.trim() } : {}),
      });
      onSaved(r.application);
    } catch (err) {
      setError(applicationsErrorMessage(err, 'Could not save.'));
      setBusy(false);
    }
  }

  return (
    <Sheet
      label={`Update ${a.shop_name}`}
      title={a.shop_name}
      message={`${a.owner_name} · ${localPhone(a.phone)}`}
      busy={busy}
      submitLabel={busy ? 'Saving…' : 'Save'}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className="segmented sellers-filters" role="group" aria-label="Application status">
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
      <TextField label="Staff note (optional)" hint={`${note.length}/${APPLICATION_NOTE_MAX} · only staff see it`}>
        <textarea className="input" rows={3} maxLength={APPLICATION_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </TextField>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
