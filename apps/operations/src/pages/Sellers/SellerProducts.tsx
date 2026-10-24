import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { catalog } from '../../api/resources';
import type { Category } from '../../api/types';
import { sellerSubmissions } from '../../api/sellers';
import { PageHeader } from '../../components/Layout';
import { EmptyState, Spinner } from '../../components/ui';
import { categoryOptions } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import {
  NOT_READY_TEXT,
  REASON_LIMITS,
  approvalBody,
  changedFields,
  effectiveSelling,
  lkr,
  margin,
  notReady,
  parseMoney,
  reasonProblem,
  sellerContact,
  sellingPriceRequired,
  type AdminSubmission,
  type LiveProductView,
} from '../../lib/sellers';
import { BackToMore, Sheet, TextField } from './parts';
import './sellers.css';

/**
 * More -> Seller products: the approval queue (owner, 2026-10-25: same as Admin's Seller products).
 * Nothing a seller adds or changes is visible to customers until it is approved here. For each
 * waiting submission staff see what the seller proposed (for a change, the live product next to it),
 * set the price customers pay (the seller's own price is Blynk's cost; a price below it is warned
 * about), optionally move the product to another category, and approve or reject with a reason.
 * Oldest first.
 */
const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });

export function SellerProducts() {
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('seller') ?? undefined;
  const [rows, setRows] = useState<AdminSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const load = useCallback(async () => {
    try {
      setRows(await sellerSubmissions.list({ status: 'PENDING', seller_id: sellerId }));
      setError(null);
    } catch (err) {
      setError(notReady(err) ? NOT_READY_TEXT : errorMessage(err, 'Could not load the seller products.'));
      setRows([]);
    }
  }, [sellerId]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  useEffect(() => {
    void catalog.categories.list().then(setCategories).catch(() => setCategories([]));
  }, []);

  const options = useMemo(() => categoryOptions(categories), [categories]);
  const categoryName = useCallback(
    (id: string | null | undefined) => options.find((o) => o.id === id)?.label ?? (id ? 'Unknown category' : '—'),
    [options]
  );

  /** A decided submission leaves the queue at once. */
  const done = (id: string, message: string) => {
    setNotice(message);
    setRows((r) => (r ?? []).filter((s) => s.id !== id));
  };

  return (
    <div className="page">
      <BackToMore to="/more/sellers" label="← Sellers" />
      <PageHeader title="Seller products" description="What sellers added or changed. Nothing goes live until you approve it and set the price customers pay." />
      {sellerId ? (
        <button type="button" className="button" style={{ minHeight: 44 }} onClick={() => setParams({})}>
          Show every seller
        </button>
      ) : null}

      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
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
        <ul className="cat-list" aria-label="Waiting products">
          {rows.map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              options={options.map((o) => ({ id: o.id, label: o.label }))}
              categoryName={categoryName}
              onDone={(message) => done(s.id, message)}
              onFailed={(message) => setNotice(message)}
            />
          ))}
        </ul>
      )}
    </div>
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
    catalog.products
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
      onDone(`${name} is approved${isEdit ? '' : ' and live'}. The seller gets an SMS.`);
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
      onDone(`${name} was rejected. The seller gets an SMS.`);
    } catch (err) {
      onFailed(errorMessage(err, 'Could not reject this.'));
      setRejecting(false);
      setBusy(false);
    }
  }

  const proposedImage = p.image_url ?? live?.image_url ?? null;

  return (
    <li className="card" aria-label={`${isEdit ? 'Change to' : 'New product'} ${name}`}>
      <div>
        <span className={isEdit ? 'submission-kind submission-kind--edit' : 'submission-kind'}>{isEdit ? 'Change to a live product' : 'New product'}</span>
        <h2 className="growth-card__title" style={{ margin: '6px 0 2px' }}>
          {name}
        </h2>
        <p className="sellers-card__meta">
          <Link className="link" to={`/more/sellers/${sub.seller.id}`}>
            {sub.seller.shop_name}
          </Link>{' '}
          · {sellerContact(sub.seller)} · sent {when.format(new Date(sub.created_at))}
        </p>
      </div>

      {proposedImage ? <img className="seller-thumb" src={proposedImage} alt={`Photo of ${name}`} /> : null}
      <dl className="seller-facts">
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
          <dt>Seller&apos;s price</dt>
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
          <div>
            <dt>Description</dt>
            <dd>{p.description}</dd>
          </div>
        ) : null}
      </dl>

      {isEdit ? (
        <div aria-label="What changed">
          <h3 className="seller-point__title">What changed</h3>
          {changes.length === 0 ? (
            <p className="sellers-card__meta">Nothing differs from the live product that we can compare.</p>
          ) : (
            <ul className="seller-compare" aria-label="Live versus proposed">
              {changes.map((c) => (
                <li key={c.key}>
                  <strong>{c.label}</strong>
                  <span className="seller-compare__was">{c.key === 'image_url' ? <ChangePhoto src={c.live} label="Live photo" /> : <>Live now: {c.live || '—'}</>}</span>
                  <span className="seller-compare__now">{c.key === 'image_url' ? <ChangePhoto src={c.proposed} label="Proposed photo" /> : <>Seller wants: {c.proposed || '—'}</>}</span>
                </li>
              ))}
            </ul>
          )}
          {sub.product?.selling_price != null ? <p className="sellers-card__meta">Customers pay {lkr(sub.product.selling_price)} for it now.</p> : null}
        </div>
      ) : null}

      <TextField
        label={`Selling price (LKR)${required ? '' : ' - optional'}`}
        hint={`${required ? 'What customers pay. ' : "The seller's price did not change, so the live price stays unless you type a new one. "}Blynk's cost is the seller's price, ${lkr(sellerPrice)}.`}
      >
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
      </TextField>
      <TextField label="Category (optional change)">
        <select className="input" aria-label={`Category for ${name}`} value={override} onChange={(e) => setOverride(e.target.value)}>
          <option value="">Seller&apos;s choice: {sub.category_name ?? categoryName(p.category_id)}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </TextField>

      {m ? (
        m.belowCost ? (
          <p className="seller-warn" role="alert">
            Below cost: customers would pay {lkr(price!)} but the seller is owed {lkr(sellerPrice)}, so Blynk loses {lkr(Math.abs(m.amount))} on every unit.
          </p>
        ) : (
          <p className="sellers-card__meta" aria-label="Margin">
            Margin: {lkr(m.amount)} per unit{m.percent != null ? ` (${m.percent}% over the seller's price)` : ''}.
          </p>
        )
      ) : null}

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sellers-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-label={`Reject ${name}`}
          onClick={() => {
            setReason('');
            setReasonError(null);
            setRejecting(true);
          }}
        >
          Reject
        </button>
        <button type="button" className="button button--ink" disabled={busy} aria-label={`Approve ${name}`} onClick={() => void approve()}>
          {busy && !rejecting ? 'Approving…' : 'Approve'}
        </button>
      </div>

      {rejecting ? (
        <Sheet
          label={`Reject ${name}`}
          title={`Reject ${name}?`}
          busy={busy}
          submitLabel={busy ? 'Rejecting…' : 'Reject'}
          submitTone="danger"
          submitDisabled={!reason.trim()}
          onClose={() => setRejecting(false)}
          onSubmit={() => void reject()}
        >
          <TextField label="Reason (sent to the seller by SMS)" error={reasonError}>
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
          </TextField>
        </Sheet>
      ) : null}
    </li>
  );
}

function ChangePhoto({ src, label }: { src: string; label: string }) {
  return src ? <img className="seller-thumb" src={src} alt={label} /> : <span>No photo</span>;
}
