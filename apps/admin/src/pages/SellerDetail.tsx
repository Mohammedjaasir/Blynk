import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { categories as categoriesApi, sellerPayoutRequests, sellers as sellersApi } from '../api/resources';
import type { Category } from '../api/types';
import { ApiError } from '../api/client';
import { DatePicker } from '../components/DatePicker';
import { ImageUploader } from '../components/ImageUploader';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Field, Spinner, useToast } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/apiErrors';
import { categoryOptions } from '../lib/categoryTree';
import { colomboDateKey } from '../lib/schedule';
import {
  EMPTY_PRODUCT_FORM,
  HOW_TO_FIND_MAX,
  LOCATION_REASON_MAX,
  PRODUCT_STATUS_LABEL,
  REASON_LIMITS,
  SELLER_STATUS_LABEL,
  approvedPoint,
  distanceText,
  endOfColomboDay,
  extendFreePeriod,
  freeDaysLeft,
  freePeriodText,
  googleMapsUrl,
  newSellerProductBody,
  parsePastedPoint,
  productStatusTone,
  shopLocationBody,
  type NewSellerProductForm,
  type ProductFormField,
  type SellerProductRow,
  locationReasonProblem,
  locationWaiting,
  osmEmbedUrl,
  pendingPoint,
  pointText,
  type MapPoint,
  lkr,
  METHOD_LABEL,
  normalisePhone,
  notReady,
  parseCommission,
  parseMoney,
  phoneInUseText,
  readablePhone,
  sellerContact,
  reasonProblem,
  sellerActions,
  sellerStatusTone,
  type AdminSeller,
  type PayoutRequest,
  type SellerPayout,
  type SellerStatement,
} from '../lib/sellers';
import './sellers.css';

/**
 * One seller: profile (staff keep the sign-in phone and contact details: sellers are invite-only),
 * status decisions (approve / reject with a reason / suspend), commission (their own rate, or the
 * category rates), the statement of what Blynk owes them, their payout requests (pay / decline) and
 * the payouts ledger (payments are made by hand and recorded here; a mistaken entry can be deleted).
 */
const stamp = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' });
const dayText = (key: string) => (/^\d{4}-\d{2}-\d{2}/.test(key) ? stamp.format(new Date(`${key.slice(0, 10)}T00:00:00+05:30`)) : key);

type Decision = 'approve' | 'reject' | 'suspend';

export function SellerDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [seller, setSeller] = useState<AdminSeller | null>(null);
  const [statement, setStatement] = useState<SellerStatement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commission, setCommission] = useState('');
  const [commissionMode, setCommissionMode] = useState<'category' | 'own'>('own');
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SellerPayout | null>(null);
  const [editing, setEditing] = useState(false);

  const adopt = useCallback((s: AdminSeller) => {
    setSeller(s);
    const own = s.commission_percent !== null && s.commission_percent !== undefined;
    setCommissionMode(own ? 'own' : 'category');
    setCommission(own ? String(Number(s.commission_percent)) : '');
    setCommissionError(null);
  }, []);

  useEffect(() => {
    let live = true;
    setSeller(null);
    sellersApi
      .get(id)
      .then((d) => {
        if (!live) return;
        adopt(d.seller);
        setStatement(d.statement);
        setLoadError(null);
      })
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load this seller.')));
    return () => {
      live = false;
    };
  }, [id, adopt]);

  /** Status changes return only the seller; the statement stays as loaded. */
  async function decide(kind: Decision) {
    if (!seller) return;
    if (kind === 'reject') {
      const problem = reasonProblem(reason);
      if (problem) {
        setReasonError(problem);
        return;
      }
    }
    setBusy(true);
    try {
      const updated = await sellersApi.update(
        seller.id,
        kind === 'approve'
          ? { status: 'APPROVED' }
          : kind === 'suspend'
            ? { status: 'SUSPENDED' }
            : { status: 'REJECTED', rejection_reason: reason.trim() }
      );
      adopt({ ...seller, ...updated });
      toast.success(
        kind === 'approve' ? `${seller.shop_name} is approved and gets an app notification.` : kind === 'suspend' ? `${seller.shop_name} is suspended.` : `${seller.shop_name} was rejected.`
      );
      setDeciding(null);
      setReason('');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change the seller.'));
      setDeciding(null);
    } finally {
      setBusy(false);
    }
  }

  async function saveCommission() {
    if (!seller) return;
    let value: number | null = null;
    if (commissionMode === 'own') {
      const read = parseCommission(commission);
      if ('error' in read) {
        setCommissionError(read.error);
        return;
      }
      value = read.value;
    }
    setCommissionError(null);
    setBusy(true);
    try {
      const updated = await sellersApi.update(seller.id, { commission_percent: value });
      adopt({ ...seller, ...updated });
      // The commission changes what is earned: read the statement again.
      const d = await sellersApi.get(seller.id);
      setStatement(d.statement);
      toast.success('Commission saved.');
    } catch (err) {
      setCommissionError(errorMessage(err, 'Could not save the commission.'));
    } finally {
      setBusy(false);
    }
  }

  async function removePayout(payout: SellerPayout) {
    if (!seller) return;
    setBusy(true);
    try {
      setStatement(await sellersApi.deletePayout(seller.id, payout.id));
      toast.success('Payment deleted.');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the payment.'));
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Seller" actions={<Link className="button button--ghost" to="/sellers">All sellers</Link>} />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </>
    );
  }
  if (!seller || !statement) return <Spinner label="Loading this seller" />;

  const actions = sellerActions(seller.status);

  return (
    <>
      <PageHeader
        title={seller.shop_name}
        description={`${sellerContact(seller)} · joined ${stamp.format(new Date(seller.created_at))}`}
        actions={
          <>
            <Link className="button button--ghost" to="/sellers">
              All sellers
            </Link>
            {seller.submissions_pending > 0 ? (
              <Link className="button button--ghost" to={`/seller-products?seller=${seller.id}`}>
                {seller.submissions_pending} waiting for approval
              </Link>
            ) : null}
          </>
        }
      />

      <section className="seller-card" aria-label="Profile">
        <div className="seller-card__head">
          <Badge tone={sellerStatusTone(seller.status)}>{SELLER_STATUS_LABEL[seller.status]}</Badge>
          <div className="row-actions">
            <button type="button" className="button button--ghost" disabled={busy} onClick={() => setEditing(true)}>
              Edit details
            </button>
            {actions.approve ? (
              <button type="button" className="button" disabled={busy} onClick={() => setDeciding('approve')}>
                {seller.status === 'PENDING' ? 'Approve' : 'Approve again'}
              </button>
            ) : null}
            {actions.reject ? (
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => {
                  setReason('');
                  setReasonError(null);
                  setDeciding('reject');
                }}
              >
                Reject
              </button>
            ) : null}
            {actions.suspend ? (
              <button type="button" className="button button--danger" disabled={busy} onClick={() => setDeciding('suspend')}>
                Suspend
              </button>
            ) : null}
          </div>
        </div>
        <p className="form__note seller-signin">
          {seller.phone
            ? `Signs in with ${readablePhone(seller.phone)} (SMS code on the seller site).`
            : seller.email
              ? `Signs in with ${seller.email} (email and password). Add a phone number with Edit details to let them use an SMS code.`
              : 'No sign-in number yet: add one with Edit details.'}
        </p>
        <dl className="seller-card__facts">
          <div>
            <dt>{seller.phone || !seller.email ? 'Phone' : 'Email'}</dt>
            <dd className="mono">{sellerContact(seller)}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>{seller.contact_name || seller.full_name || '—'}</dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{seller.address || '—'}</dd>
          </div>
          <div>
            <dt>Note from the seller</dt>
            <dd>{seller.note || '—'}</dd>
          </div>
          <div>
            <dt>Live products</dt>
            <dd>{seller.products_live}</dd>
          </div>
          {seller.status === 'REJECTED' && seller.rejection_reason ? (
            <div>
              <dt>Rejected because</dt>
              <dd>{seller.rejection_reason}</dd>
            </div>
          ) : null}
        </dl>

        <form
          className="seller-commission"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void saveCommission();
          }}
        >
          <fieldset className="seller-commission__mode">
            <legend className="field__label">Commission (% kept by Blynk from the seller's price)</legend>
            <label className="seller-commission__choice">
              <input
                type="radio"
                name="commission-mode"
                checked={commissionMode === 'category'}
                onChange={() => {
                  setCommissionMode('category');
                  setCommissionError(null);
                }}
              />
              Use category rates
            </label>
            <label className="seller-commission__choice">
              <input
                type="radio"
                name="commission-mode"
                checked={commissionMode === 'own'}
                onChange={() => {
                  setCommissionMode('own');
                  setCommissionError(null);
                }}
              />
              Own rate
            </label>
          </fieldset>
          {commissionMode === 'own' ? (
            <label className="field">
              <span className="field__label">Own rate (%)</span>
              <input
                className="input seller-commission__input"
                inputMode="decimal"
                aria-label="Commission percent"
                value={commission}
                onChange={(e) => {
                  setCommission(e.target.value);
                  setCommissionError(null);
                }}
              />
              {commissionError ? (
                <span className="field__error">{commissionError}</span>
              ) : (
                <span className="field__hint">Used for every sale of this seller, whatever the category. 0 means Blynk's gain is only the markup.</span>
              )}
            </label>
          ) : (
            <p className="field__hint seller-commission__hint">
              Each sale uses its category's rate (a sub-category falls back to its main category), else the default. Set them under Sellers → Seller commission.
            </p>
          )}
          <button
            type="submit"
            className="button"
            disabled={
              busy ||
              (commissionMode === 'category'
                ? seller.commission_percent === null || seller.commission_percent === undefined
                : seller.commission_percent !== null &&
                  seller.commission_percent !== undefined &&
                  commission.trim() === String(Number(seller.commission_percent)))
            }
          >
            Save commission
          </button>
        </form>

        <FreePeriod seller={seller} onChanged={(s) => setSeller({ ...seller, ...s })} />
      </section>

      <ProductsSection seller={seller} />

      <LocationSection seller={seller} onChanged={(s) => adopt({ ...seller, ...s })} />

      <StatementSection statement={statement} />

      <PayoutRequestsSection seller={seller} onPaid={(s) => setStatement(s)} />

      <PayoutsSection
        seller={seller}
        statement={statement}
        onRecorded={(s) => setStatement(s)}
        onDelete={(p) => setDeleting(p)}
      />

      {deciding === 'approve' ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label={`Approve ${seller.shop_name}?`}>
          <div className="modal__panel">
            <h2 className="modal__title">Approve {seller.shop_name}?</h2>
            <p className="modal__message">
              {seller.status === 'SUSPENDED'
                ? 'They can add products again and get an app notification. Products that were switched off when they were suspended stay off until you switch them on in Products.'
                : 'They can add products from now on and get an app notification.'}
            </p>
            {/* A warning, not a block (lead, 2026-10-24): the seller can pin the shop later. */}
            {approvedPoint(seller) ? null : (
              <p className="submission__warn" role="note">
                {locationWaiting(seller)
                  ? 'Their shop location is still waiting for your approval (see Shop location), so riders do not know yet where to collect their goods.'
                  : 'They have no approved shop location yet, so riders do not know where to collect their goods. You can still approve them.'}
              </p>
            )}
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setDeciding(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (!busy) void decide('approve');
                }}
              >
                {busy ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deciding === 'suspend' ? (
        <ConfirmDialog
          title={`Suspend ${seller.shop_name}?`}
          message="Their products are switched off in the customer app now, and they cannot add or change products. Approving them again does not switch the products back on."
          confirmLabel={busy ? 'Suspending…' : 'Suspend'}
          destructive
          onConfirm={() => {
            if (!busy) void decide('suspend');
          }}
          onCancel={() => setDeciding(null)}
        />
      ) : null}

      {deciding === 'reject' ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Reject seller">
          <form
            className="modal__panel"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void decide('reject');
            }}
          >
            <h2 className="modal__title">Reject {seller.shop_name}?</h2>
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
              <button type="button" className="button button--ghost" onClick={() => setDeciding(null)}>
                Cancel
              </button>
              <button type="submit" className="button button--danger" disabled={busy || !reason.trim()}>
                {busy ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editing ? (
        <EditDetailsDialog
          seller={seller}
          onClose={() => setEditing(false)}
          onSaved={(s) => {
            adopt({ ...seller, ...s });
            setEditing(false);
            toast.success('Seller details saved.');
          }}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          title="Delete this payment?"
          message={`${lkr(deleting.amount)} paid on ${dayText(deleting.paid_on)} is removed from the list and the amount due goes back up. Only do this for a mistaken entry.`}
          confirmLabel={busy ? 'Deleting…' : 'Delete payment'}
          destructive
          onConfirm={() => {
            if (!busy) void removePayout(deleting);
          }}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Where the seller's shop is (migration 053): the approved point (riders collect there and delivery
 * is measured from it) next to the one the seller asked for, which waits for Approve / Reject.
 */
function LocationSection({ seller, onChanged }: { seller: AdminSeller; onChanged(s: AdminSeller): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);

  const approved = approvedPoint(seller);
  const pending = pendingPoint(seller);
  const waiting = locationWaiting(seller);
  const rejected = seller.location_status === 'REJECTED' && pending !== null;

  async function approve() {
    setBusy(true);
    try {
      onChanged(await sellersApi.approveLocation(seller.id));
      toast.success(`${seller.shop_name}'s shop location is approved.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not approve the shop location.'));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const problem = locationReasonProblem(reason);
    if (problem) {
      setReasonError(problem);
      return;
    }
    setBusy(true);
    try {
      onChanged(await sellersApi.rejectLocation(seller.id, reason.trim()));
      toast.success(`${seller.shop_name}'s shop location was rejected.`);
      setRejecting(false);
      setReason('');
    } catch (err) {
      setReasonError(errorMessage(err, 'Could not reject the shop location.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="seller-card" aria-label="Shop location">
      <h2 className="form__section-title">Shop location</h2>
      <p className="form__note">Where riders collect this seller's goods. Only the approved point is used for delivery.</p>
      <div className="seller-location__set">
        <button type="button" className="button button--ghost" disabled={busy} onClick={() => setSetting(true)}>
          Set shop location
        </button>
        <span className="form__note">For a seller who cannot pin the shop themselves: it is approved straight away.</span>
      </div>
      {!approved && !pending ? (
        <p className="seller-location__empty">No location set yet</p>
      ) : (
        <div className="seller-location">
          <LocationPoint
            label="Approved location"
            title="Approved (in use)"
            point={approved}
            note={seller.location_note ?? null}
            distance={seller.distance_km_from_store}
            emptyText="No approved location yet"
          />
          {pending ? (
            <LocationPoint
              label={rejected ? 'Rejected location' : 'Waiting location'}
              title={rejected ? 'Rejected request' : 'Waiting for your approval'}
              point={pending}
              note={seller.pending_location_note ?? null}
              distance={seller.pending_distance_km_from_store}
              tone={rejected ? 'rejected' : 'waiting'}
            >
              {rejected && seller.location_reject_reason ? (
                <p className="form__note">Rejected because: {seller.location_reject_reason}</p>
              ) : null}
              {waiting ? (
                <div className="row-actions">
                  <button type="button" className="button" disabled={busy} onClick={() => void approve()}>
                    {busy ? 'Saving…' : 'Approve location'}
                  </button>
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
                    Reject location
                  </button>
                </div>
              ) : null}
            </LocationPoint>
          ) : null}
        </div>
      )}

      {setting ? (
        <SetLocationDialog
          seller={seller}
          onClose={() => setSetting(false)}
          onSaved={(s) => {
            setSetting(false);
            onChanged(s);
            toast.success(`${seller.shop_name}'s shop location is set and approved.`);
          }}
        />
      ) : null}

      {rejecting ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Reject shop location">
          <form
            className="modal__panel"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void reject();
            }}
          >
            <h2 className="modal__title">Reject this shop location?</h2>
            <p className="modal__message">The seller sees the reason and can pin the shop again. {approved ? 'The approved location stays in use.' : ''}</p>
            <label className="field">
              <span className="field__label">Reason (shown to the seller)</span>
              <textarea
                className="input"
                rows={3}
                maxLength={LOCATION_REASON_MAX}
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

/**
 * Commission-free period (2026-10-30): a seller pays no commission on orders delivered before this
 * date (30 days from approval by default). Staff can pick another date, add 30 days or end it now.
 */
function FreePeriod({ seller, onChanged }: { seller: AdminSeller; onChanged(s: AdminSeller): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const until = seller.commission_free_until ?? null;
  const left = freeDaysLeft(until);
  const today = colomboDateKey();

  async function change(next: string, done: string) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await sellersApi.update(seller.id, { commission_free_until: next }));
      setPicking(false);
      toast.success(done);
    } catch (err) {
      setError(errorMessage(err, 'Could not change the commission-free date.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seller-free" role="group" aria-label="Commission-free period">
      <p className="seller-free__text">{freePeriodText(until)}</p>
      <p className="form__note">
        No commission is taken on orders delivered before this date; after it the rates above apply. New sellers get the free days set under Sellers → Seller commission.
      </p>
      <div className="row-actions">
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={busy}
          onClick={() => {
            setDate(until ? colomboDateKey(until) : today);
            setError(null);
            setPicking((v) => !v);
          }}
        >
          Edit date
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={busy}
          onClick={() => void change(extendFreePeriod(until, 30), 'Commission-free period extended by 30 days.')}
        >
          Extend by 30 days
        </button>
        <button
          type="button"
          className="button button--ghost button--sm"
          disabled={busy || !left}
          onClick={() => void change(new Date().toISOString(), 'Commission-free period ended. Normal rates apply from now.')}
        >
          End now
        </button>
      </div>
      {picking ? (
        <div className="seller-commission">
          <div className="field">
            <span className="field__label">Commission-free until (end of that day)</span>
            <DatePicker value={date} onChange={setDate} label="Commission-free until" today={today} markPast={false} />
          </div>
          <button type="button" className="button" disabled={busy || !date} onClick={() => void change(endOfColomboDay(date), 'Commission-free date saved.')}>
            {busy ? 'Saving…' : 'Save date'}
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What the seller sells (2026-10-30): the products with their status (Live = on sale, Paused = the seller
 * switched it off, Off = staff switched it off) and, for an approved seller, "Add product" for sellers who do
 * not know how: staff create a live product for them.
 */
function ProductsSection({ seller }: { seller: AdminSeller }) {
  const toast = useToast();
  const [state, setRows] = useSellerList<SellerProductRow>(() => sellersApi.products(seller.id), [seller.id]);
  const [adding, setAdding] = useState(false);
  const rows = state && 'rows' in state ? state.rows : [];
  const approved = seller.status === 'APPROVED';

  return (
    <section className="seller-card" aria-label="Products">
      <div className="seller-card__head">
        <h2 className="form__section-title">
          Products{state && 'rows' in state ? ` (${rows.filter((p) => p.status === 'LIVE').length} live of ${rows.length})` : ''}
        </h2>
        {approved ? (
          <button type="button" className="button" onClick={() => setAdding(true)}>
            Add product
          </button>
        ) : null}
      </div>
      {!approved ? <p className="form__note">Products can be added for this seller once they are approved.</p> : null}
      <ListState state={state} empty="This seller has no products yet." />
      {rows.length > 0 ? (
        <div className="table-wrap">
          <table className="table" aria-label="Seller's products">
            <thead>
              <tr>
                <th scope="col">Photo</th>
                <th scope="col">Product</th>
                <th scope="col">Category</th>
                <th scope="col" className="num">
                  Seller price
                </th>
                <th scope="col" className="num">
                  Customer price
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Stock
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.image_url ? (
                      <img className="seller-products__thumb" src={p.image_url} alt={p.name} />
                    ) : (
                      <span className="seller-products__thumb seller-products__thumb--empty">No photo</span>
                    )}
                  </td>
                  <td>{p.name}</td>
                  <td>{p.category_name ?? '—'}</td>
                  <td className="num">{p.seller_price === null || p.seller_price === undefined ? '—' : lkr(p.seller_price)}</td>
                  <td className="num">{p.selling_price === null || p.selling_price === undefined ? '—' : lkr(p.selling_price)}</td>
                  <td>
                    <Badge tone={productStatusTone(p.status)}>{PRODUCT_STATUS_LABEL[p.status]}</Badge>
                  </td>
                  <td className="num">{p.stock_on_hand === null || p.stock_on_hand === undefined ? '—' : p.stock_on_hand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {adding ? (
        <AddProductDialog
          seller={seller}
          onClose={() => setAdding(false)}
          onAdded={async (product) => {
            setAdding(false);
            toast.success(`${product.name} is added for ${seller.shop_name} and is live.`);
            try {
              setRows(await sellersApi.products(seller.id));
            } catch {
              setRows([...rows, product]);
            }
          }}
        />
      ) : null}
    </section>
  );
}

const PRODUCT_FIELDS: readonly ProductFormField[] = ['name', 'category_id', 'unit', 'image_url', 'seller_price', 'selling_price', 'stock_quantity'];

/** Staff add a product for the seller: name, category, unit, a required photo, both prices, opening stock. */
function AddProductDialog({ seller, onClose, onAdded }: { seller: AdminSeller; onClose(): void; onAdded(p: SellerProductRow): void }) {
  const [form, setForm] = useState<NewSellerProductForm>(EMPTY_PRODUCT_FORM);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Partial<Record<ProductFormField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    categoriesApi
      .listAdmin()
      .then((rows) => live && setCategories(rows))
      .catch(() => live && setCategories([]));
    return () => {
      live = false;
    };
  }, []);

  const text = (key: keyof NewSellerProductForm) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
    setFormError(null);
  };

  async function save() {
    const read = newSellerProductBody(form);
    if ('errors' in read) {
      setErrors(read.errors);
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    setBusy(true);
    try {
      onAdded(await sellersApi.createProduct(seller.id, read.body));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IMAGE_REQUIRED') {
        setErrors({ image_url: err.message || 'Add a photo of the product.' });
      } else {
        const server = fieldErrors(err);
        const inline: Partial<Record<ProductFormField, string>> = {};
        for (const f of PRODUCT_FIELDS) if (server[f]) inline[f] = server[f];
        setErrors(inline);
        setFormError(errorMessage(err, 'Could not add the product.', Object.keys(inline)));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add product for seller">
      <form
        className="modal__panel modal__panel--wide"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <h2 className="modal__title">Add a product for {seller.shop_name}</h2>
        <p className="modal__message">It goes live in the customer app straight away, at the customer price you set.</p>
        <div className="seller-form-grid">
          <div className="field--wide">
            <Field label="Product name" error={errors.name}>
              <input className="input" maxLength={160} value={form.name} onChange={text('name')} />
            </Field>
          </div>
          <Field label="Category" error={errors.category_id}>
            <select className="input" value={form.category_id} onChange={text('category_id')}>
              <option value="">Select a category</option>
              {categoryOptions(categories).map(({ category, label }) => (
                <option key={category.id} value={category.id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unit" hint="e.g. 1 L, 500 g, pack" error={errors.unit}>
            <input className="input" value={form.unit} onChange={text('unit')} />
          </Field>
          <Field label="Pack size" hint="Optional">
            <input className="input" value={form.pack_size} onChange={text('pack_size')} />
          </Field>
          <Field label="Barcode" hint="Optional">
            <input className="input" value={form.barcode} onChange={text('barcode')} />
          </Field>
          <div className="field--wide">
            <Field label="Description" hint="Optional">
              <textarea className="input" rows={2} value={form.description} onChange={text('description')} />
            </Field>
          </div>
          <Field label="Seller's price (LKR)" hint="What Blynk pays the seller" error={errors.seller_price}>
            <input className="input" inputMode="decimal" value={form.seller_price} onChange={text('seller_price')} />
          </Field>
          <Field label="Customer price (LKR)" hint="What customers pay" error={errors.selling_price}>
            <input className="input" inputMode="decimal" value={form.selling_price} onChange={text('selling_price')} />
          </Field>
          <Field label="Opening stock" hint="Optional, a whole number" error={errors.stock_quantity}>
            <input className="input" inputMode="numeric" value={form.stock_quantity} onChange={text('stock_quantity')} />
          </Field>
        </div>
        <div className="field--wide">
          <ImageUploader
            value={form.image_url}
            folder="products"
            label="Product photo (required)"
            onChange={(url) => {
              setForm((f) => ({ ...f, image_url: url }));
              setErrors((er) => ({ ...er, image_url: undefined }));
              setFormError(null);
            }}
          />
          {errors.image_url ? (
            <span className="field__error" role="alert">
              {errors.image_url}
            </span>
          ) : null}
        </div>
        {formError ? (
          <p className="field__error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Adding…' : 'Add product'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Staff set the shop pin themselves (2026-10-30): latitude, longitude and how to find it; a pasted
 * Google Maps "lat, lng" (or a maps link) fills both. The point is approved straight away.
 */
function SetLocationDialog({ seller, onClose, onSaved }: { seller: AdminSeller; onClose(): void; onSaved(s: AdminSeller): void }) {
  const current = approvedPoint(seller);
  const [lat, setLat] = useState(current ? String(current.lat) : '');
  const [lng, setLng] = useState(current ? String(current.lng) : '');
  const [paste, setPaste] = useState('');
  const [how, setHow] = useState(seller.location_note ?? '');
  const [errors, setErrors] = useState<{ latitude?: string; longitude?: string; how_to_find?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = (() => {
    const plain = /^-?\d+(\.\d+)?$/;
    if (!plain.test(lat.trim()) || !plain.test(lng.trim())) return null;
    const la = Number(lat);
    const ln = Number(lng);
    return Math.abs(la) <= 90 && Math.abs(ln) <= 180 ? { lat: la, lng: ln } : null;
  })();

  function fromText(value: string) {
    const point = parsePastedPoint(value);
    if (!point) return false;
    setLat(String(point.lat));
    setLng(String(point.lng));
    setErrors({});
    setError(null);
    return true;
  }

  async function save() {
    const read = shopLocationBody(lat, lng, how);
    if ('errors' in read) {
      setErrors(read.errors);
      return;
    }
    setErrors({});
    setError(null);
    setBusy(true);
    try {
      onSaved(await sellersApi.setLocation(seller.id, read.body));
    } catch (err) {
      setError(errorMessage(err, 'Could not set the shop location.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Set shop location">
      <form
        className="modal__panel"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <h2 className="modal__title">Set the shop location of {seller.shop_name}</h2>
        <p className="modal__message">Riders collect the goods here and delivery is measured from it. It is approved straight away.</p>
        <label className="field">
          <span className="field__label">Paste from Google Maps</span>
          <input
            className="input"
            aria-label="Paste coordinates"
            placeholder="7.290572, 80.633728"
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              fromText(e.target.value);
            }}
          />
          <span className="field__hint">In Google Maps press and hold the shop, then copy the two numbers shown, and paste them here.</span>
        </label>
        <div className="seller-form-grid">
          <Field label="Latitude" error={errors.latitude}>
            <input
              className="input"
              inputMode="decimal"
              value={lat}
              onChange={(e) => {
                const v = e.target.value;
                // A "lat, lng" pair pasted into the first box fills both.
                if (!/^-?\d+(\.\d+)?$/.test(v.trim()) && fromText(v)) return;
                setLat(v);
                setErrors((er) => ({ ...er, latitude: undefined }));
              }}
            />
          </Field>
          <Field label="Longitude" error={errors.longitude}>
            <input
              className="input"
              inputMode="decimal"
              value={lng}
              onChange={(e) => {
                setLng(e.target.value);
                setErrors((er) => ({ ...er, longitude: undefined }));
              }}
            />
          </Field>
        </div>
        <Field label="How to find it" hint="Optional: a landmark or directions for the rider" error={errors.how_to_find}>
          <textarea className="input" rows={2} maxLength={HOW_TO_FIND_MAX} value={how} onChange={(e) => setHow(e.target.value)} />
        </Field>
        {preview ? (
          <a className="button button--ghost button--sm" href={googleMapsUrl(preview)} target="_blank" rel="noopener noreferrer">
            Open in Google Maps
          </a>
        ) : null}
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Saving…' : 'Save location'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LocationPoint({
  label,
  title,
  point,
  note,
  distance,
  emptyText,
  tone,
  children,
}: {
  label: string;
  title: string;
  point: MapPoint | null;
  note: string | null;
  distance: number | null | undefined;
  emptyText?: string;
  tone?: 'waiting' | 'rejected';
  children?: ReactNode;
}) {
  const far = distanceText(distance);
  return (
    <div role="group" aria-label={label} className={tone ? `seller-location__point seller-location__point--${tone}` : 'seller-location__point'}>
      <h3 className="seller-location__title">{title}</h3>
      {point ? (
        <>
          <iframe
            className="seller-location__map"
            title={`Map: ${label.toLowerCase()}`}
            src={osmEmbedUrl(point)}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <dl className="seller-card__facts">
            <div>
              <dt>Coordinates</dt>
              <dd className="mono">{pointText(point)}</dd>
            </div>
            <div>
              <dt>How to find it</dt>
              <dd>{note || '—'}</dd>
            </div>
            <div>
              <dt>Distance</dt>
              <dd>{far ?? 'Unknown (no store location)'}</dd>
            </div>
          </dl>
          <a className="button button--ghost button--sm" href={googleMapsUrl(point)} target="_blank" rel="noopener noreferrer">
            Open in Google Maps
          </a>
        </>
      ) : (
        <p className="form__note">{emptyText ?? 'No location'}</p>
      )}
      {children}
    </div>
  );
}

function StatementSection({ statement }: { statement: SellerStatement }) {
  // Per-line rates (migration 057); an older API sends none.
  const perLine = statement.lines.some((l) => typeof l.commission_percent === 'number');
  return (
    <section className="seller-card" aria-label="Statement">
      <h2 className="form__section-title">Statement (delivered orders)</h2>
      <dl className="seller-stats">
        <div>
          <dt>Sold (seller prices)</dt>
          <dd>{lkr(statement.gross)}</dd>
        </div>
        <div>
          <dt>
            {statement.commission_percent === null || statement.commission_percent === undefined
              ? 'Commission (category rates)'
              : `Commission (${Number(statement.commission_percent)}%)`}
          </dt>
          <dd>{lkr(statement.commission)}</dd>
        </div>
        <div>
          <dt>Earned</dt>
          <dd>{lkr(statement.earned)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{lkr(statement.paid)}</dd>
        </div>
        <div className="seller-stats__due">
          <dt>Due</dt>
          <dd>{lkr(statement.due)}</dd>
        </div>
      </dl>
      {statement.lines.length === 0 ? (
        <p className="form__note">Nothing delivered yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Sold products">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="num">
                  Units sold
                </th>
                <th scope="col" className="num">
                  Amount
                </th>
                {perLine ? (
                  <th scope="col" className="num">
                    Blynk keeps
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((l) => (
                <tr key={l.product_id}>
                  <td>{l.name}</td>
                  <td className="num">{l.units}</td>
                  <td className="num">{lkr(l.gross)}</td>
                  {perLine ? (
                    <td className="num">
                      {lkr(l.commission)} ({Number(l.commission_percent ?? 0)}%)
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PayoutsSection({
  seller,
  statement,
  onRecorded,
  onDelete,
}: {
  seller: AdminSeller;
  statement: SellerStatement;
  onRecorded(s: SellerStatement): void;
  onDelete(p: SellerPayout): void;
}) {
  const toast = useToast();
  const today = colomboDateKey();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function record() {
    const read = parseMoney(amount, 'amount paid');
    if ('error' in read) {
      setError(read.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await sellersApi.recordPayout(seller.id, {
        amount: read.value,
        ...(note.trim() ? { note: note.trim() } : {}),
        paid_on: date || today,
      });
      onRecorded(r.statement);
      setAmount('');
      setNote('');
      setDate(today);
      toast.success(`Payment of ${lkr(read.value)} recorded.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not record the payment.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="seller-card" aria-label="Payouts">
      <h2 className="form__section-title">Payouts</h2>
      <p className="form__note">
        Pay the seller yourself (cash or bank transfer), then record it here. Due now: <strong>{lkr(statement.due)}</strong>.
      </p>
      <form
        className="seller-payout-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void record();
        }}
      >
        <label className="field">
          <span className="field__label">Amount paid (LKR)</span>
          <input
            className="input"
            inputMode="decimal"
            aria-label="Amount paid"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
          />
        </label>
        <div className="field">
          <span className="field__label">Paid on</span>
          <DatePicker value={date} onChange={setDate} label="Paid on" today={today} max={today} markPast={false} />
        </div>
        <label className="field">
          <span className="field__label">Note (optional)</span>
          <input className="input" aria-label="Payment note" maxLength={200} placeholder="Bank transfer, ref 1234" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
      </form>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {statement.payouts.length === 0 ? (
        <EmptyState title="No payments recorded yet" />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Payments">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Note</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {statement.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{dayText(p.paid_on)}</td>
                  <td className="num">{lkr(p.amount)}</td>
                  <td>{p.note || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="button button--sm button--ghost" aria-label={`Delete payment of ${lkr(p.amount)}`} onClick={() => onDelete(p)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The 409 PHONE_IN_USE text with the account kind, else the API's own message. */
function saveError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'PHONE_IN_USE') {
    return phoneInUseText((err.details as { role?: unknown } | undefined)?.role);
  }
  return errorMessage(err, fallback);
}

/**
 * Sellers are invite-only (2026-10-24): staff keep the shop name, the sign-in phone and the contact
 * details. Only changed fields are sent; a number another account uses is refused (409).
 */
function EditDetailsDialog({ seller, onClose, onSaved }: { seller: AdminSeller; onClose(): void; onSaved(s: AdminSeller): void }) {
  const [shop, setShop] = useState(seller.shop_name);
  const [phone, setPhone] = useState(seller.phone ? readablePhone(seller.phone) : '');
  const [contact, setContact] = useState(seller.contact_name ?? '');
  const [address, setAddress] = useState(seller.address ?? '');
  const [note, setNote] = useState(seller.note ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const body: Parameters<typeof sellersApi.update>[1] = {};
    const name = shop.trim();
    if (name.length < 2 || name.length > 80) {
      setError('The shop name must be 2 to 80 characters.');
      return;
    }
    if (name !== seller.shop_name) body.shop_name = name;
    if (phone.trim()) {
      const normalised = normalisePhone(phone);
      if (!normalised) {
        setError('Enter a Sri Lankan mobile number, like 077 123 4567.');
        return;
      }
      if (normalised !== seller.phone) body.phone = normalised;
    } else if (seller.phone) {
      setError('A seller needs a phone number to sign in with an SMS code.');
      return;
    }
    if (contact.trim() !== (seller.contact_name ?? '')) body.contact_name = contact.trim() || null;
    if (address.trim() !== (seller.address ?? '')) body.address = address.trim() || null;
    if (note.trim() !== (seller.note ?? '')) body.note = note.trim() || null;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onSaved(await sellersApi.update(seller.id, body));
    } catch (err) {
      setError(saveError(err, 'Could not save the details.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Edit seller details">
      <form
        className="modal__panel"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <h2 className="modal__title">Edit {seller.shop_name}</h2>
        <label className="field">
          <span className="field__label">Shop name</span>
          <input className="input" maxLength={80} value={shop} onChange={(e) => setShop(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Phone (they sign in with it)</span>
          <input className="input" inputMode="tel" placeholder="077 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Contact name</span>
          <input className="input" maxLength={80} value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Address</span>
          <input className="input" maxLength={255} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Note</span>
          <textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Saving…' : 'Save details'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A list section's load state: rows, "after the database update" (503 before migration 057), or an error. */
type Loaded<T> = { rows: T[] } | { notReady: true } | { error: string } | null;

function useSellerList<T>(load: () => Promise<T[]>, deps: unknown[]): [Loaded<T>, (rows: T[]) => void] {
  const [state, setState] = useState<Loaded<T>>(null);
  useEffect(() => {
    let live = true;
    load()
      .then((rows) => live && setState({ rows }))
      .catch((err) => {
        if (!live) return;
        setState(notReady(err) ? { notReady: true } : { error: errorMessage(err, 'Could not load this list.') });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [state, (rows: T[]) => setState({ rows })];
}

function ListState({ state, empty }: { state: Loaded<unknown>; empty: string }) {
  if (state === null) return <p className="form__note">Loading…</p>;
  if ('notReady' in state) return <p className="form__note">Available after the next database update.</p>;
  if ('error' in state) return <p className="form__note seller-list__error">{state.error}</p>;
  return state.rows.length === 0 ? <p className="form__note">{empty}</p> : null;
}

/**
 * The seller's waiting payout request (migration 057). Paying records the payout in the ledger below
 * (same as Record payment) and notifies the seller in the app; declining needs a reason, which is sent too.
 */
function PayoutRequestsSection({ seller, onPaid }: { seller: AdminSeller; onPaid(s: SellerStatement): void }) {
  const toast = useToast();
  const today = colomboDateKey();
  const [state, setRows] = useSellerList<PayoutRequest>(() => sellerPayoutRequests.list({ status: 'REQUESTED', seller_id: seller.id }), [seller.id]);
  const [paying, setPaying] = useState<PayoutRequest | null>(null);
  const [declining, setDeclining] = useState<PayoutRequest | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = state && 'rows' in state ? state.rows : [];

  async function pay(req: PayoutRequest) {
    setBusy(true);
    try {
      const r = await sellerPayoutRequests.pay(req.id, { paid_on: date || today, ...(note.trim() ? { note: note.trim() } : {}) });
      setRows(rows.filter((x) => x.id !== req.id));
      onPaid(r.statement);
      setPaying(null);
      toast.success(`Paid ${lkr(req.amount)} and recorded it.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not record the payment.'));
    } finally {
      setBusy(false);
    }
  }

  async function decline(req: PayoutRequest) {
    const problem = reasonProblem(reason);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await sellerPayoutRequests.decline(req.id, reason.trim());
      setRows(rows.filter((x) => x.id !== req.id));
      setDeclining(null);
      toast.success('Payout request declined.');
    } catch (err) {
      setError(errorMessage(err, 'Could not decline the request.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="seller-card" aria-label="Payout requests">
      <h2 className="form__section-title">Payout requests</h2>
      <ListState state={state} empty="No payout request waiting." />
      {rows.map((r) => (
        <div key={r.id} className="seller-request" role="group" aria-label={`Payout request of ${lkr(r.amount)}`}>
          <dl className="seller-card__facts">
            <div>
              <dt>Asked for</dt>
              <dd>
                <strong>{lkr(r.amount)}</strong> ({METHOD_LABEL[r.method]})
              </dd>
            </div>
            <div>
              <dt>Due now</dt>
              <dd>{lkr(r.due)}</dd>
            </div>
            <div>
              <dt>Asked on</dt>
              <dd>{stamp.format(new Date(r.created_at))}</dd>
            </div>
            {r.bank_details ? (
              <div>
                <dt>Bank details</dt>
                <dd>{r.bank_details}</dd>
              </div>
            ) : null}
            {r.note ? (
              <div>
                <dt>Note from the seller</dt>
                <dd>{r.note}</dd>
              </div>
            ) : null}
          </dl>
          {r.amount > r.due ? <p className="submission__warn">This is more than is due now: decline it and let the seller ask again.</p> : null}
          <div className="row-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setDate(today);
                setNote('');
                setError(null);
                setPaying(r);
              }}
            >
              Mark paid
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setReason('');
                setError(null);
                setDeclining(r);
              }}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {paying ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Pay the seller">
          <form
            className="modal__panel"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void pay(paying);
            }}
          >
            <h2 className="modal__title">Paid {lkr(paying.amount)}?</h2>
            <p className="modal__message">
              Pay {seller.shop_name} yourself ({METHOD_LABEL[paying.method].toLowerCase()}), then record it here. It is added to the payments below and the seller gets an app notification.
            </p>
            <div className="field">
              <span className="field__label">Paid on</span>
              <DatePicker value={date} onChange={setDate} label="Paid on" today={today} max={today} markPast={false} />
            </div>
            <label className="field">
              <span className="field__label">Note (optional)</span>
              <input className="input" aria-label="Payout note" maxLength={200} placeholder="Transfer ref 1234" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setPaying(null)}>
                Cancel
              </button>
              <button type="submit" className="button" disabled={busy}>
                {busy ? 'Recording…' : 'Record payment'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {declining ? (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Decline payout request">
          <form
            className="modal__panel"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void decline(declining);
            }}
          >
            <h2 className="modal__title">Decline {lkr(declining.amount)}?</h2>
            <label className="field">
              <span className="field__label">Reason (sent to the seller as an app notification)</span>
              <textarea
                className="input"
                rows={3}
                maxLength={REASON_LIMITS.max}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
              />
              {error ? <span className="field__error">{error}</span> : null}
            </label>
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={() => setDeclining(null)}>
                Cancel
              </button>
              <button type="submit" className="button button--danger" disabled={busy || !reason.trim()}>
                {busy ? 'Declining…' : 'Decline'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
