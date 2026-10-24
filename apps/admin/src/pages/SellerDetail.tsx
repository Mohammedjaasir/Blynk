import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { sellers as sellersApi } from '../api/resources';
import { DatePicker } from '../components/DatePicker';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { colomboDateKey } from '../lib/schedule';
import {
  LOCATION_REASON_MAX,
  REASON_LIMITS,
  SELLER_STATUS_LABEL,
  approvedPoint,
  distanceText,
  googleMapsUrl,
  locationReasonProblem,
  locationWaiting,
  osmEmbedUrl,
  pendingPoint,
  pointText,
  type MapPoint,
  lkr,
  parseCommission,
  parseMoney,
  sellerContact,
  reasonProblem,
  sellerActions,
  sellerStatusTone,
  type AdminSeller,
  type SellerPayout,
  type SellerStatement,
} from '../lib/sellers';
import './sellers.css';

/**
 * One seller: profile, status decisions (approve / reject with a reason / suspend), commission, the
 * statement of what Blynk owes them, and the payouts ledger (payments are made by hand and recorded
 * here; a mistaken entry can be deleted).
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
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SellerPayout | null>(null);

  const adopt = useCallback((s: AdminSeller) => {
    setSeller(s);
    setCommission(String(Number(s.commission_percent)));
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
        kind === 'approve' ? `${seller.shop_name} is approved and gets an SMS.` : kind === 'suspend' ? `${seller.shop_name} is suspended.` : `${seller.shop_name} was rejected.`
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
    const read = parseCommission(commission);
    if ('error' in read) {
      setCommissionError(read.error);
      return;
    }
    setCommissionError(null);
    setBusy(true);
    try {
      const updated = await sellersApi.update(seller.id, { commission_percent: read.value });
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
          <label className="field">
            <span className="field__label">Commission (% kept by Blynk from the seller's price)</span>
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
            {commissionError ? <span className="field__error">{commissionError}</span> : <span className="field__hint">0 means Blynk's gain is only the markup on the seller's price.</span>}
          </label>
          <button type="submit" className="button" disabled={busy || commission.trim() === String(Number(seller.commission_percent))}>
            Save commission
          </button>
        </form>
      </section>

      <LocationSection seller={seller} onChanged={(s) => adopt({ ...seller, ...s })} />

      <StatementSection statement={statement} />

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
                ? 'They can add products again and get an SMS. Products that were switched off when they were suspended stay off until you switch them on in Products.'
                : 'They can add products from now on and get an SMS.'}
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
              <span className="field__label">Reason (sent to the seller by SMS)</span>
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
  return (
    <section className="seller-card" aria-label="Statement">
      <h2 className="form__section-title">Statement (delivered orders)</h2>
      <dl className="seller-stats">
        <div>
          <dt>Sold (seller prices)</dt>
          <dd>{lkr(statement.gross)}</dd>
        </div>
        <div>
          <dt>Commission ({Number(statement.commission_percent)}%)</dt>
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
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((l) => (
                <tr key={l.product_id}>
                  <td>{l.name}</td>
                  <td className="num">{l.units}</td>
                  <td className="num">{lkr(l.gross)}</td>
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
