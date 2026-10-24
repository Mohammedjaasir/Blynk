import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  featureErrorMessage,
  productRequests as requestsApi,
  type ProductRequestGroup,
  type ProductRequestSort,
  type ProductRequestStatus,
} from '../api/engagement';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Field, Spinner, useToast } from '../components/ui';
import {
  REQUEST_STATUSES,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  dayText,
  requestCounts,
  sortRequestGroups,
  whenText,
} from '../lib/engagement';
import { ProductPicker } from './Promotions';
import './engagement.css';

/**
 * Product requests (owner, 2026-10-24: "Can't find it? Ask us - customers request products we
 * don't stock, Admin sees the most-requested list"). Same-named requests are grouped; staff mark a
 * group Planned, Added (pick the product - the requesters are told it is in) or Not stocking, with a
 * note. Blynk Ops has the same page.
 */
type Filter = ProductRequestStatus | 'ALL';
type Decision = Exclude<ProductRequestStatus, 'NEW'>;
const DECISIONS: Decision[] = ['PLANNED', 'ADDED', 'DECLINED'];
const NOTE_MAX = 300;

export function ProductRequests() {
  const [sort, setSort] = useState<ProductRequestSort>('popular');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [groups, setGroups] = useState<ProductRequestGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  // Every status is loaded at once, so the chips can show their counts.
  const load = useCallback(async () => {
    try {
      setGroups(await requestsApi.list({ sort }));
      setError(null);
    } catch (err) {
      setError(featureErrorMessage(err, 'Could not load the product requests.'));
      setGroups([]);
    }
  }, [sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => requestCounts(groups ?? []), [groups]);
  const totalRequests = useMemo(() => (groups ?? []).reduce((n, g) => n + (g.requests_total ?? g.count ?? 0), 0), [groups]);
  const shown = useMemo(
    () => sortRequestGroups((groups ?? []).filter((g) => filter === 'ALL' || g.status === filter), sort),
    [groups, filter, sort]
  );

  return (
    <>
      <PageHeader
        title="Product requests"
        description="What customers asked for that Blynk does not stock (from the app's “Can't find it? Ask us”). The same product asked for by many customers is shown once with its count."
        actions={
          <div className="segmented" role="group" aria-label="Sort">
            {(['popular', 'newest'] as ProductRequestSort[]).map((s) => (
              <button
                key={s}
                type="button"
                className={s === sort ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={s === sort}
                onClick={() => setSort(s)}
              >
                {s === 'popular' ? 'Most requested' : 'Newest'}
              </button>
            ))}
          </div>
        }
      />

      <div className="requests__bar">
        <div className="segmented" role="group" aria-label="Status">
          {(['ALL', ...REQUEST_STATUSES] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={f === filter ? 'segmented__item is-selected' : 'segmented__item'}
              aria-pressed={f === filter}
              onClick={() => setFilter(f)}
            >
              {f === 'ALL' ? 'All' : REQUEST_STATUS_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
        {groups && groups.length > 0 ? (
          <p className="cell__secondary" data-testid="requests-total">
            {groups.length} {groups.length === 1 ? 'product' : 'products'} asked for · {totalRequests}{' '}
            {totalRequests === 1 ? 'request' : 'requests'}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {groups === null ? (
        <Spinner label="Loading the product requests" />
      ) : shown.length === 0 ? (
        error ? null : (
          <EmptyState
            title={groups.length === 0 ? 'No requests yet' : 'No requests here'}
            message={groups.length === 0 ? 'When a customer cannot find a product and asks for it, it appears here.' : undefined}
          />
        )
      ) : (
        <ul className="request-groups" aria-label="Requested products">
          {shown.map((g) => (
            <RequestGroup
              key={g.key}
              group={g}
              editing={editing === g.key}
              open={openKey === g.key}
              onEdit={() => setEditing(editing === g.key ? null : g.key)}
              onToggle={() => setOpenKey(openKey === g.key ? null : g.key)}
              onSaved={() => {
                setEditing(null);
                void load();
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function RequestGroup({
  group: g,
  editing,
  open,
  onEdit,
  onToggle,
  onSaved,
}: {
  group: ProductRequestGroup;
  editing: boolean;
  open: boolean;
  onEdit(): void;
  onToggle(): void;
  onSaved(): void;
}) {
  return (
    <li className="request-group" aria-label={g.name}>
      <div className="request-group__head">
        <div>
          <p className="cell__primary request-group__name">{g.name}</p>
          <p className="cell__secondary">
            {g.category_name ? `${g.category_name} · ` : ''}Last asked {dayText(g.last_requested_at)}
          </p>
        </div>
        <span className="request-group__count mono" aria-label={`${g.count} ${g.count === 1 ? 'request' : 'requests'}`}>
          ×{g.count}
        </span>
        <Badge tone={REQUEST_STATUS_TONE[g.status] ?? 'muted'}>{REQUEST_STATUS_LABEL[g.status] ?? g.status}</Badge>
        <div className="row-actions">
          <button type="button" className="button button--ghost button--sm" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} requests for ${g.name}`} onClick={onToggle}>
            {open ? 'Hide' : 'Requests'}
          </button>
          <button type="button" className="button button--sm" aria-expanded={editing} aria-label={`Update ${g.name}`} onClick={onEdit}>
            Update
          </button>
        </div>
      </div>
      {g.status === 'ADDED' && (g.product_name || g.product_id) ? (
        <p className="form__note">
          Added as{' '}
          {g.product_id ? <Link to={`/products/${g.product_id}`}>{g.product_name ?? 'the product'}</Link> : g.product_name}
        </p>
      ) : null}
      {g.staff_note ? <p className="form__note">Note: {g.staff_note}</p> : null}

      {open ? (
        <ul className="request-group__requests" aria-label={`Requests for ${g.name}`}>
          {g.requests.map((r) => {
            const phone = r.customer?.phone ?? r.phone ?? null;
            const guest = r.guest ?? (!r.customer && !r.customer_name && !phone);
            return (
            <li key={r.id}>
              <span className="cell__secondary">{whenText(r.created_at)}</span> ·{' '}
              {r.customer?.name ?? r.customer_name ?? (guest ? 'Guest' : 'Customer')}
              {phone ? (
                <>
                  {' '}
                  <a href={`tel:${phone}`}>{phone}</a>
                </>
              ) : null}
              {r.name !== g.name ? <> · “{r.name}”</> : null}
              {r.note ? <div>{r.note}</div> : null}
              {r.photo_url ? <img src={r.photo_url} alt={`Photo for ${r.name}`} className="request-group__photo" /> : null}
            </li>
            );
          })}
        </ul>
      ) : null}

      {editing ? <DecisionForm group={g} onSaved={onSaved} onCancel={onEdit} /> : null}
    </li>
  );
}

function DecisionForm({ group: g, onSaved, onCancel }: { group: ProductRequestGroup; onSaved(): void; onCancel(): void }) {
  const toast = useToast();
  const [decision, setDecision] = useState<Decision>(g.status === 'NEW' ? 'PLANNED' : (g.status as Decision));
  const [productId, setProductId] = useState(g.product_id ?? '');
  const [productName, setProductName] = useState<string | null>(g.product_name ?? null);
  const [note, setNote] = useState(g.staff_note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = decision === 'ADDED' && !productId ? 'Pick the product it was added as.' : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    setError(null);
    try {
      await requestsApi.update(g.key, {
        status: decision,
        ...(decision === 'ADDED' ? { product_id: productId } : {}),
        // Sent when written, or blank to clear an earlier note.
        ...(note.trim() || g.staff_note ? { staff_note: note.trim() } : {}),
      });
      toast.success(
        decision === 'ADDED'
          ? `${g.name} marked added. The ${g.count === 1 ? 'customer is' : `${g.count} customers are`} told it is in.`
          : `${g.name} marked ${REQUEST_STATUS_LABEL[decision].toLowerCase()}.`
      );
      onSaved();
    } catch (err) {
      setError(featureErrorMessage(err, 'Could not save.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="form request-group__form"
      aria-label={`Update ${g.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="segmented" role="group" aria-label="Decision">
        {DECISIONS.map((d) => (
          <button
            key={d}
            type="button"
            className={d === decision ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={d === decision}
            onClick={() => setDecision(d)}
          >
            {REQUEST_STATUS_LABEL[d]}
          </button>
        ))}
      </div>
      {decision === 'ADDED' ? (
        <ProductPicker
          value={productId}
          name={productName}
          onChange={(id, name) => {
            setProductId(id);
            setProductName(name);
          }}
        />
      ) : null}
      <Field label="Note (optional)" hint={`${note.length}/${NOTE_MAX} · for staff`}>
        <textarea className="input" rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {problem ? <p className="field__hint">{problem}</p> : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="form__actions">
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={saving || !!problem}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
