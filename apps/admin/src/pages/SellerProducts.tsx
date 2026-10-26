import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { categories as categoriesApi, products as productsApi, sellerSubmissions } from '../api/resources';
import type { Category } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { categoryOptions } from '../lib/categoryTree';
import {
  REASON_LIMITS,
  approvalBody,
  changedFields,
  effectiveSelling,
  lkr,
  margin,
  parseMoney,
  sellerContact,
  reasonProblem,
  sellingPriceRequired,
  type AdminSubmission,
  type LiveProductView,
} from '../lib/sellers';
import './sellers.css';

/**
 * Seller products: the approval queue (seller portal, 2026-10-24). Nothing a seller adds or changes
 * is visible to customers until it is approved here. For each waiting submission Admin sees what the
 * seller proposed (for a change, the live product next to it), sets the price customers pay (the
 * seller's own price is Blynk's cost), and approves or rejects with a reason. Oldest first.
 */
const stamp = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });

export function SellerProducts() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('seller') ?? undefined;
  const [rows, setRows] = useState<AdminSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const load = useCallback(async () => {
    try {
      setRows(await sellerSubmissions.list({ status: 'PENDING', seller_id: sellerId }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the seller products.'));
      setRows([]);
    }
  }, [sellerId]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  useEffect(() => {
    void categoriesApi.listAdmin().then(setCategories).catch(() => setCategories([]));
  }, []);

  const options = useMemo(() => categoryOptions(categories), [categories]);
  const categoryName = useCallback(
    (id: string | null | undefined) => options.find((o) => o.category.id === id)?.label ?? (id ? 'Unknown category' : '—'),
    [options]
  );

  /** A decided submission leaves the queue at once. */
  const done = (id: string) => setRows((r) => (r ?? []).filter((s) => s.id !== id));

  return (
    <>
      <PageHeader
        title="Seller products"
        description="What sellers added or changed. Nothing goes live until you approve it and set the price customers pay."
        actions={
          sellerId ? (
            <button type="button" className="button button--ghost" onClick={() => setParams({})}>
              Show every seller
            </button>
          ) : undefined
        }
      />
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null ? (
        <Spinner label="Loading the seller products" />
      ) : rows.length === 0 ? (
        error ? null : <EmptyState title="Nothing waiting for approval" message="New products and changes from sellers appear here, oldest first." />
      ) : (
        <div className="submission-list">
          {rows.map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              options={options.map((o) => ({ id: o.category.id, label: o.label }))}
              categoryName={categoryName}
              onDone={(message) => {
                toast.success(message);
                done(s.id);
              }}
              onFailed={(message) => toast.error(message)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function SubmissionCard({
  submission: sub,
  options,
  categoryName,
  onDone,
  onFailed,
}: {
  submission: AdminSubmission;
  options: { id: string; label: string }[];
  categoryName: (id: string | null | undefined) => string;
  onDone(message: string): void;
  onFailed(message: string): void;
}) {
  const p = sub.payload;
  const isEdit = sub.kind === 'EDIT';
  const [live, setLive] = useState<LiveProductView | null>(null);
  const [selling, setSelling] = useState('');
  const [override, setOverride] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  // The live product, so an edit can show every field next to what the seller wants.
  useEffect(() => {
    if (!isEdit || !sub.product_id) return;
    let alive = true;
    productsApi
      .getAdmin(sub.product_id)
      .then((v) => alive && setLive(v as unknown as LiveProductView))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isEdit, sub.product_id]);

  const changes = changedFields(sub, live, categoryName);
  const required = sellingPriceRequired(sub);
  const typed = (() => {
    const read = parseMoney(selling, 'selling price');
    return 'value' in read ? read.value : null;
  })();
  const price = effectiveSelling(sub, typed);
  const sellerPrice = Number(sub.seller_price);
  const m = price == null ? null : margin(price, sellerPrice);
  const name = p.name ?? sub.product?.name ?? 'This product';

  async function approve() {
    const read = approvalBody(sub, selling, override);
    if ('error' in read) {
      setError(read.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await sellerSubmissions.approve(sub.id, read.body);
      onDone(`${name} is approved${isEdit ? '' : ' and live'}. The seller gets an app notification.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not approve this.'));
      setBusy(false);
    }
  }

  async function reject() {
    const problem = reasonProblem(reason);
    if (problem) {
      setReasonError(problem);
      return;
    }
    setBusy(true);
    try {
      await sellerSubmissions.reject(sub.id, reason.trim());
      onDone(`${name} was rejected. The seller gets an app notification.`);
    } catch (err) {
      onFailed(errorMessage(err, 'Could not reject this.'));
      setRejecting(false);
      setBusy(false);
    }
  }

  const proposedImage = p.image_url ?? live?.image_url ?? null;

  return (
    <section className="submission" aria-label={`${isEdit ? 'Change to' : 'New product'} ${name}`}>
      <header className="submission__head">
        <div>
          <span className={`submission__kind${isEdit ? ' submission__kind--edit' : ''}`}>{isEdit ? 'Change to a live product' : 'New product'}</span>
          <h2 className="submission__title">{name}</h2>
          <p className="cell__secondary">
            <Link to={`/sellers/${sub.seller.id}`}>{sub.seller.shop_name}</Link> · {sellerContact(sub.seller)} · sent {stamp.format(new Date(sub.created_at))}
          </p>
        </div>
      </header>

      <div className="submission__body">
        <div className="submission__photo">
          {proposedImage ? <img src={proposedImage} alt={`Photo of ${name}`} /> : <span className="thumb__empty">No photo</span>}
        </div>
        <dl className="submission__facts">
          <div>
            <dt>Category</dt>
            <dd>{sub.category_name ?? categoryName(p.category_id)}</dd>
          </div>
          <div>
            <dt>Unit</dt>
            <dd>
              {p.unit ?? live?.unit ?? '—'}
              {p.pack_size ? ` · ${p.pack_size}` : ''}
            </dd>
          </div>
          <div>
            <dt>Seller's price</dt>
            <dd>
              <strong>{lkr(sellerPrice)}</strong>
            </dd>
          </div>
          {p.barcode ? (
            <div>
              <dt>Barcode</dt>
              <dd className="mono">{p.barcode}</dd>
            </div>
          ) : null}
          {p.description ? (
            <div className="submission__wide">
              <dt>Description</dt>
              <dd>{p.description}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {isEdit ? (
        <div className="submission__changes" aria-label="What changed">
          <h3 className="form__section-title">What changed</h3>
          {changes.length === 0 ? (
            <p className="form__note">Nothing differs from the live product that we can compare.</p>
          ) : (
            <table className="table" aria-label="Live versus proposed">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Live now</th>
                  <th scope="col">Seller wants</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.key}>
                    <th scope="row">{c.label}</th>
                    <td className="submission__was">{c.key === 'image_url' ? <ChangePhoto src={c.live} label="Live photo" /> : c.live || '—'}</td>
                    <td className="submission__now">{c.key === 'image_url' ? <ChangePhoto src={c.proposed} label="Proposed photo" /> : c.proposed || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {sub.product?.selling_price != null ? (
            <p className="form__note">Customers pay {lkr(sub.product.selling_price)} for it now.</p>
          ) : null}
        </div>
      ) : null}

      <div className="submission__price">
        <label className="field">
          <span className="field__label">Selling price (LKR){required ? '' : ' - optional'}</span>
          <input
            className="input"
            inputMode="decimal"
            aria-label={`Selling price for ${name}`}
            placeholder={!required && sub.product?.selling_price != null ? `Keep ${lkr(sub.product.selling_price)}` : undefined}
            value={selling}
            onChange={(e) => {
              setSelling(e.target.value);
              setError(null);
            }}
          />
          <span className="field__hint">
            {required ? 'What customers pay. ' : "The seller's price did not change, so the live price stays unless you type a new one. "}
            Blynk's cost is the seller's price, {lkr(sellerPrice)}.
          </span>
        </label>
        <label className="field">
          <span className="field__label">Category (optional change)</span>
          <select className="input" aria-label={`Category for ${name}`} value={override} onChange={(e) => setOverride(e.target.value)}>
            <option value="">Seller's choice: {sub.category_name ?? categoryName(p.category_id)}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {m ? (
        m.belowCost ? (
          <p className="submission__warn" role="alert">
            Below cost: customers would pay {lkr(price!)} but the seller is owed {lkr(sellerPrice)}, so Blynk loses {lkr(Math.abs(m.amount))} on every unit.
          </p>
        ) : (
          <p className="submission__margin" aria-label="Margin">
            Margin: {lkr(m.amount)} per unit{m.percent != null ? ` (${m.percent}% over the seller's price)` : ''}.
          </p>
        )
      ) : null}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="submission__actions">
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => {
            setReason('');
            setReasonError(null);
            setRejecting(true);
          }}
        >
          Reject
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => void approve()}>
          {busy && !rejecting ? 'Approving…' : 'Approve'}
        </button>
      </div>

      {rejecting ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Reject ${name}`}>
          <form
            className="modal__panel"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void reject();
            }}
          >
            <h2 className="modal__title">Reject {name}?</h2>
            <label className="field">
              <span className="field__label">Reason (sent to the seller as an app notification)</span>
              <textarea
                className="input"
                rows={3}
                maxLength={REASON_LIMITS.max}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(null);
                }}
              />
              {reasonError ? <span className="field__error">{reasonError}</span> : null}
            </label>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setRejecting(false)}>
                Cancel
              </button>
              <button type="submit" className="button button--danger" disabled={busy || !reason.trim()}>
                {busy ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function ChangePhoto({ src, label }: { src: string; label: string }) {
  return src ? <img className="submission__thumb" src={src} alt={label} /> : <span>No photo</span>;
}
