import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { productRequests, type ProductRequestGroup, type ProductRequestStatus } from '../../api/growth';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Field, Spinner, Status, type Tone } from '../../components/ui';
import '../../components/growth.css';
import { formatDateTime } from '../../lib/inventory';
import { REQUEST_STATUS_LABEL, growthErrorMessage, isNotReady } from '../../lib/growth';
import { TargetProductPicker } from './Promotions';

/**
 * Catalog -> Product requests (plan 2026-10-24-groups-ratings-requests.md §C): "Can't find
 * it? Ask us" - products customers asked for that Blynk does not stock, same names grouped.
 * Most requested or newest first. Staff mark a group Planned, Added (picking the product -
 * everyone who asked is then told it is available) or Not stocking; it applies to the whole
 * group.
 */

type Sort = 'popular' | 'newest';
type StatusFilter = ProductRequestStatus | 'ALL';

const STATUS_FILTERS: { id: StatusFilter; text: string }[] = [
  { id: 'ALL', text: 'All' },
  { id: 'NEW', text: 'New' },
  { id: 'PLANNED', text: 'Planned' },
  { id: 'ADDED', text: 'Added' },
  { id: 'DECLINED', text: 'Not stocking' },
];

const STATUS_TONE: Record<ProductRequestStatus, Tone> = { NEW: 'info', PLANNED: 'warn', ADDED: 'ok', DECLINED: 'muted' };

const ACTIONS: { status: Exclude<ProductRequestStatus, 'NEW'>; text: string }[] = [
  { status: 'PLANNED', text: 'Planned' },
  { status: 'ADDED', text: 'Added' },
  { status: 'DECLINED', text: 'Not stocking' },
];

export function ProductRequests() {
  const [sort, setSort] = useState<Sort>('popular');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [groups, setGroups] = useState<ProductRequestGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ group: ProductRequestGroup; to: Exclude<ProductRequestStatus, 'NEW'> } | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await productRequests.list({ sort, ...(status === 'ALL' ? {} : { status }) });
      setGroups(status === 'ALL' ? list : list.filter((g) => g.status === status));
      setError(null);
      setNotReady(false);
    } catch (err) {
      setGroups([]);
      setNotReady(isNotReady(err));
      setError(growthErrorMessage(err, 'Could not load the product requests.'));
    }
  }, [sort, status]);

  useEffect(() => {
    setGroups(null);
    void load();
  }, [load]);

  return (
    <div className="page">
      <Link to="/catalog" className="link">
        ← Catalog
      </Link>
      <PageHeader title="Product requests" description="Products customers asked for that we don't stock yet. Same names are grouped." />

      <div className="segmented growth-filters" role="group" aria-label="Sort requests">
        {(
          [
            { id: 'popular', text: 'Most requested' },
            { id: 'newest', text: 'Newest' },
          ] as const
        ).map((s) => (
          <button
            key={s.id}
            type="button"
            className={sort === s.id ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={sort === s.id}
            onClick={() => setSort(s.id)}
          >
            {s.text}
          </button>
        ))}
      </div>
      <div className="segmented growth-filters" role="group" aria-label="Request status">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={status === s.id ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={status === s.id}
            onClick={() => setStatus(s.id)}
          >
            {s.text}
          </button>
        ))}
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

      {groups === null ? (
        <Spinner label="Loading product requests" />
      ) : groups.length === 0 ? (
        error ? null : <EmptyState title="No product requests here" message="Customers ask from search, category lists and their account in the app." />
      ) : (
        <ul className="cat-list" aria-label="Product requests">
          {groups.map((g) => (
            <RequestCard key={g.key} group={g} onAction={(to) => setEditing({ group: g, to })} />
          ))}
        </ul>
      )}

      {editing ? (
        <UpdateSheet
          group={editing.group}
          to={editing.to}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice(text);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function RequestCard({ group: g, onAction }: { group: ProductRequestGroup; onAction(to: Exclude<ProductRequestStatus, 'NEW'>): void }) {
  return (
    <li className="card growth-card" aria-label={g.name}>
      <div className="growth-card__head">
        <div>
          <p className="growth-card__title">{g.name}</p>
          <p className="growth-card__meta">
            <strong data-testid="request-count">
              {g.count} {g.count === 1 ? 'request' : 'requests'}
            </strong>
            {g.last_requested_at ? ` · last ${formatDateTime(g.last_requested_at)}` : ''}
            {g.category_name ? ` · ${g.category_name}` : ''}
          </p>
        </div>
        <span className="request-status">
          <Status tone={STATUS_TONE[g.status]}>{REQUEST_STATUS_LABEL[g.status]}</Status>
        </span>
      </div>
      {g.status === 'ADDED' && (g.product_name || g.product_id) ? (
        <p className="growth-card__meta">
          Added as{' '}
          {g.product_id ? (
            <Link className="link" to={`/catalog/products/${g.product_id}`}>
              {g.product_name ?? 'the product'}
            </Link>
          ) : (
            g.product_name
          )}
        </p>
      ) : null}
      {g.staff_note ? <p className="growth-card__meta">Note: {g.staff_note}</p> : null}
      {g.requests.length > 0 ? (
        <details>
          <summary className="link">Who asked ({g.requests.length})</summary>
          <ul className="cat-list">
            {g.requests.map((r) => (
              <li key={r.id} className="growth-card__meta">
                {[r.customer_name ?? r.customer_phone ?? 'Guest', r.created_at ? formatDateTime(r.created_at) : null].filter(Boolean).join(' · ')}
                {r.note ? ` - “${r.note}”` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="growth-card__actions">
        {ACTIONS.filter((a) => a.status !== g.status).map((a) => (
          <button
            key={a.status}
            type="button"
            className={a.status === 'ADDED' ? 'button' : 'button button--ghost'}
            aria-label={`${a.text}: ${g.name}`}
            onClick={() => onAction(a.status)}
          >
            {a.text}
          </button>
        ))}
      </div>
    </li>
  );
}

const SHEET_TITLE: Record<Exclude<ProductRequestStatus, 'NEW'>, string> = {
  PLANNED: 'Mark as planned',
  ADDED: 'Mark as added',
  DECLINED: 'Mark as not stocking',
};

function UpdateSheet({
  group,
  to,
  onClose,
  onSaved,
}: {
  group: ProductRequestGroup;
  to: Exclude<ProductRequestStatus, 'NEW'>;
  onClose(): void;
  onSaved(notice: string): void;
}) {
  const [product, setProduct] = useState<{ id: string; name: string } | null>(
    group.product_id ? { id: group.product_id, name: group.product_name ?? 'Product' } : null
  );
  const [note, setNote] = useState(group.staff_note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (to === 'ADDED' && !product) {
      setError('Choose the product it was added as.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await productRequests.update(group.key, {
        status: to,
        ...(to === 'ADDED' && product ? { product_id: product.id } : {}),
        ...(trimmed ? { staff_note: trimmed } : {}),
      });
      onSaved(
        to === 'ADDED'
          ? `"${group.name}" marked added. Everyone who asked is told it is available.`
          : `"${group.name}" marked ${REQUEST_STATUS_LABEL[to].toLowerCase()}.`
      );
    } catch (err) {
      setError(growthErrorMessage(err, 'Could not save the request.'));
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={SHEET_TITLE[to]}>
      <div className="modal__panel">
        <h2 className="modal__title">{SHEET_TITLE[to]}</h2>
        <p className="modal__message">
          “{group.name}” · {group.count} {group.count === 1 ? 'request' : 'requests'}
          {to === 'ADDED' ? '. Everyone who asked gets a message that it is now available.' : '.'}
        </p>
        {to === 'ADDED' ? (
          <TargetProductPicker
            selectedId={product?.id ?? null}
            selectedName={product?.name ?? null}
            onPick={(p) => setProduct(p ? { id: p.id, name: p.name } : null)}
          />
        ) : null}
        <Field label="Staff note (optional)" hint="Only staff see this.">
          <textarea className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Back
          </button>
          <button type="button" className="button" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
