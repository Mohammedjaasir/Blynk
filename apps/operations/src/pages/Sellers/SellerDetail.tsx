import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { sellerPayoutRequests, sellers as sellersApi } from '../../api/sellers';
import { PageHeader } from '../../components/Layout';
import { ConfirmDialog, EmptyState, Spinner } from '../../components/ui';
import { colomboTodayDay } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import {
  LOCATION_REASON_MAX,
  METHOD_LABEL,
  NOT_READY_TEXT,
  REASON_LIMITS,
  approvedPoint,
  dayText,
  distanceText,
  googleMapsUrl,
  lkr,
  locationReasonProblem,
  locationWaiting,
  normalisePhone,
  notReady,
  parseCommission,
  parseMoney,
  pendingPoint,
  phoneInUseText,
  readablePhone,
  reasonProblem,
  sellerActions,
  sellerContact,
  pointText,
  type AdminSeller,
  type MapPoint,
  type PayoutRequest,
  type SellerPayout,
  type SellerStatement,
} from '../../lib/sellers';
import { BackToMore, SellerStatusPill, Sheet, TextField, type Loaded } from './parts';
import './sellers.css';

/**
 * One seller (owner, 2026-10-25: the seller admin inside Ops; same API as Admin's SellerDetail).
 * Profile (staff keep the sign-in phone and contact details: sellers are invite-only), the status
 * decisions (approve / reject with a reason / suspend), the commission (their own rate or the
 * category rates), the shop location (approve / reject the pin the seller set), the statement, their
 * payout requests (pay / decline) and the payouts ledger (payments are made by hand and recorded
 * here; a mistaken entry can be deleted).
 */
type Decision = 'approve' | 'reject' | 'suspend';
type Notify = (text: string) => void;

export function SellerDetail() {
  const { id = '' } = useParams();
  const [seller, setSeller] = useState<AdminSeller | null>(null);
  const [statement, setStatement] = useState<SellerStatement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
        kind === 'approve' ? { status: 'APPROVED' } : kind === 'suspend' ? { status: 'SUSPENDED' } : { status: 'REJECTED', rejection_reason: reason.trim() }
      );
      adopt({ ...seller, ...updated });
      setNotice(kind === 'approve' ? `${seller.shop_name} is approved and gets an app notification.` : kind === 'suspend' ? `${seller.shop_name} is suspended.` : `${seller.shop_name} was rejected.`);
      setDeciding(null);
      setReason('');
    } catch (err) {
      setNotice(errorMessage(err, 'Could not change the seller.'));
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
      setNotice('Commission saved.');
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
      setNotice('Payment deleted.');
    } catch (err) {
      setNotice(errorMessage(err, 'Could not delete the payment.'));
    } finally {
      setDeleting(null);
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <BackToMore to="/more/sellers" label="← All sellers" />
        <p className="field__error" role="alert">
          {loadError}
        </p>
      </div>
    );
  }
  if (!seller || !statement) return <Spinner label="Loading this seller" />;

  const actions = sellerActions(seller.status);
  const noCommissionChange =
    commissionMode === 'category'
      ? seller.commission_percent === null || seller.commission_percent === undefined
      : seller.commission_percent !== null && seller.commission_percent !== undefined && commission.trim() === String(Number(seller.commission_percent));

  return (
    <div className="page">
      <BackToMore to="/more/sellers" label="← All sellers" />
      <PageHeader title={seller.shop_name} description={`${sellerContact(seller)} · joined ${dayText(seller.created_at)}`} />

      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}

      <section className="card" aria-label="Profile">
        <div className="sellers-card__head">
          <SellerStatusPill status={seller.status} />
          {seller.submissions_pending > 0 ? (
            <Link className="sellers-chip sellers-chip--waiting" to={`/more/seller-products?seller=${seller.id}`}>
              {seller.submissions_pending} waiting for approval
            </Link>
          ) : null}
        </div>
        <div className="sellers-actions">
          {actions.approve ? (
            <button type="button" className="button button--ink" disabled={busy} onClick={() => setDeciding('approve')}>
              {seller.status === 'PENDING' ? 'Approve' : 'Approve again'}
            </button>
          ) : null}
          {actions.reject ? (
            <button
              type="button"
              className="button"
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
          <button type="button" className="button" disabled={busy} onClick={() => setEditing(true)}>
            Edit details
          </button>
        </div>
        <p className="sellers-card__meta">
          {seller.phone
            ? `Signs in with ${readablePhone(seller.phone)} (SMS code on the seller site).`
            : seller.email
              ? `Signs in with ${seller.email} (email and password). Add a phone number with Edit details to let them use an SMS code.`
              : 'No sign-in number yet: add one with Edit details.'}
        </p>
        <dl className="seller-facts">
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
      </section>

      <section className="card" aria-label="Commission">
        <h2 className="growth-card__title">Commission</h2>
        <p className="sellers-card__meta">The % Blynk keeps from the seller&apos;s price on each sale.</p>
        <form
          className="field"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void saveCommission();
          }}
        >
          <label className="seller-choice">
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
          <label className="seller-choice">
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
          {commissionMode === 'own' ? (
            <TextField
              label="Own rate (%)"
              error={commissionError}
              hint="Used for every sale of this seller, whatever the category. 0 means Blynk's gain is only the markup."
            >
              <input
                className="input"
                inputMode="decimal"
                aria-label="Commission percent"
                value={commission}
                onChange={(e) => {
                  setCommission(e.target.value);
                  setCommissionError(null);
                }}
              />
            </TextField>
          ) : (
            <p className="field__hint">
              Each sale uses its category&apos;s rate (a sub-category falls back to its main category), else the default. Set them under{' '}
              <Link className="link" to="/more/seller-commission">
                Seller commission
              </Link>
              .
            </p>
          )}
          <button type="submit" className="button button--ink" disabled={busy || noCommissionChange} style={{ minHeight: 44 }}>
            Save commission
          </button>
        </form>
      </section>

      <LocationSection seller={seller} onChanged={(s) => adopt({ ...seller, ...s })} onNotify={setNotice} />

      <StatementSection statement={statement} />

      <PayoutRequestsSection seller={seller} onPaid={(s) => setStatement(s)} onNotify={setNotice} />

      <PayoutsSection seller={seller} statement={statement} onRecorded={(s) => setStatement(s)} onDelete={(p) => setDeleting(p)} onNotify={setNotice} />

      {deciding === 'approve' ? (
        <div className="modal seller-sheet" role="dialog" aria-modal="true" aria-label={`Approve ${seller.shop_name}?`}>
          <div className="modal__panel">
            <h2 className="modal__title">Approve {seller.shop_name}?</h2>
            <p className="modal__message">
              {seller.status === 'SUSPENDED'
                ? 'They can add products again and get an app notification. Products that were switched off when they were suspended stay off until you switch them on in Products.'
                : 'They can add products from now on and get an app notification.'}
            </p>
            {/* A warning, not a block: the seller can pin the shop later. */}
            {approvedPoint(seller) ? null : (
              <p className="seller-warn" role="note">
                {locationWaiting(seller)
                  ? 'Their shop location is still waiting for your approval (see Shop location), so riders do not know yet where to collect their goods.'
                  : 'They have no approved shop location yet, so riders do not know where to collect their goods. You can still approve them.'}
              </p>
            )}
            <div className="seller-sheet__actions">
              <button type="button" className="button button--ghost" onClick={() => setDeciding(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--ink"
                disabled={busy}
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
        <Sheet
          label="Reject seller"
          title={`Reject ${seller.shop_name}?`}
          busy={busy}
          submitLabel={busy ? 'Rejecting…' : 'Reject'}
          submitTone="danger"
          submitDisabled={!reason.trim()}
          onClose={() => setDeciding(null)}
          onSubmit={() => void decide('reject')}
        >
          <TextField label="Reason (sent to the seller as an app notification)" error={reasonError}>
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

      {editing ? (
        <EditDetailsSheet
          seller={seller}
          onClose={() => setEditing(false)}
          onSaved={(s) => {
            adopt({ ...seller, ...s });
            setEditing(false);
            setNotice('Seller details saved.');
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
    </div>
  );
}

/**
 * Where the seller's shop is (migration 053): the approved point (riders collect there and delivery
 * is measured from it) next to the one the seller asked for, which waits for Approve / Reject.
 */
function LocationSection({ seller, onChanged, onNotify }: { seller: AdminSeller; onChanged(s: AdminSeller): void; onNotify: Notify }) {
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
      onNotify(`${seller.shop_name}'s shop location is approved.`);
    } catch (err) {
      onNotify(notReady(err) ? NOT_READY_TEXT : errorMessage(err, 'Could not approve the shop location.'));
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
      onNotify(`${seller.shop_name}'s shop location was rejected.`);
      setRejecting(false);
      setReason('');
    } catch (err) {
      setReasonError(notReady(err) ? NOT_READY_TEXT : errorMessage(err, 'Could not reject the shop location.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Shop location">
      <h2 className="growth-card__title">Shop location</h2>
      <p className="sellers-card__meta">Where riders collect this seller&apos;s goods. Only the approved point is used for delivery.</p>
      {!approved && !pending ? (
        <p className="sellers-card__meta">No location set yet</p>
      ) : (
        <>
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
              {rejected && seller.location_reject_reason ? <p className="sellers-card__meta">Rejected because: {seller.location_reject_reason}</p> : null}
              {waiting ? (
                <div className="sellers-actions">
                  <button type="button" className="button button--ink" disabled={busy} onClick={() => void approve()}>
                    {busy ? 'Saving…' : 'Approve location'}
                  </button>
                  <button
                    type="button"
                    className="button"
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
        </>
      )}

      {rejecting ? (
        <Sheet
          label="Reject shop location"
          title="Reject this shop location?"
          message={`The seller sees the reason and can pin the shop again. ${approved ? 'The approved location stays in use.' : ''}`}
          busy={busy}
          submitLabel={busy ? 'Rejecting…' : 'Reject'}
          submitTone="danger"
          submitDisabled={!reason.trim()}
          onClose={() => setRejecting(false)}
          onSubmit={() => void reject()}
        >
          <TextField label="Reason (shown to the seller)" error={reasonError}>
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
          </TextField>
        </Sheet>
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
    <div role="group" aria-label={label} className={tone ? `seller-point seller-point--${tone}` : 'seller-point'}>
      <h3 className="seller-point__title">{title}</h3>
      {point ? (
        <>
          <dl className="seller-facts">
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
          <a className="button" style={{ minHeight: 44, textAlign: 'center' }} href={googleMapsUrl(point)} target="_blank" rel="noopener noreferrer">
            Open in Google Maps
          </a>
        </>
      ) : (
        <p className="sellers-card__meta">{emptyText ?? 'No location'}</p>
      )}
      {children}
    </div>
  );
}

function StatementSection({ statement }: { statement: SellerStatement }) {
  // Per-line rates (migration 057); an older API sends none.
  const perLine = statement.lines.some((l) => typeof l.commission_percent === 'number');
  return (
    <section className="card" aria-label="Statement">
      <h2 className="growth-card__title">Statement (delivered orders)</h2>
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
        <p className="sellers-card__meta">Nothing delivered yet.</p>
      ) : (
        <ul className="seller-lines" aria-label="Sold products">
          {statement.lines.map((l) => (
            <li key={l.product_id}>
              <span className="seller-lines__text">
                {l.name}
                <br />
                <span className="sellers-card__meta">{l.units} sold</span>
              </span>
              <span className="seller-lines__amount">
                {lkr(l.gross)}
                {perLine ? (
                  <>
                    <br />
                    <span className="sellers-card__meta">
                      Blynk keeps {lkr(l.commission)} ({Number(l.commission_percent ?? 0)}%)
                    </span>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PayoutsSection({
  seller,
  statement,
  onRecorded,
  onDelete,
  onNotify,
}: {
  seller: AdminSeller;
  statement: SellerStatement;
  onRecorded(s: SellerStatement): void;
  onDelete(p: SellerPayout): void;
  onNotify: Notify;
}) {
  const today = colomboTodayDay();
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
      onNotify(`Payment of ${lkr(read.value)} recorded.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not record the payment.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Payouts">
      <h2 className="growth-card__title">Payouts</h2>
      <p className="sellers-card__meta">
        Pay the seller yourself (cash or bank transfer), then record it here. Due now: <strong>{lkr(statement.due)}</strong>.
      </p>
      <form
        className="field"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void record();
        }}
      >
        <TextField label="Amount paid (LKR)">
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
        </TextField>
        <TextField label="Paid on">
          <input className="input" type="date" aria-label="Paid on" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </TextField>
        <TextField label="Note (optional)">
          <input className="input" aria-label="Payment note" maxLength={200} placeholder="Bank transfer, ref 1234" value={note} onChange={(e) => setNote(e.target.value)} />
        </TextField>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="button button--ink" disabled={busy} style={{ minHeight: 44 }}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
      </form>

      {statement.payouts.length === 0 ? (
        <EmptyState title="No payments recorded yet" />
      ) : (
        <ul className="seller-lines" aria-label="Payments">
          {statement.payouts.map((p) => (
            <li key={p.id}>
              <span className="seller-lines__text">
                <strong>{lkr(p.amount)}</strong>
                <br />
                <span className="sellers-card__meta">
                  {dayText(p.paid_on)}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
              </span>
              <button type="button" className="button button--sm button--ghost" style={{ minHeight: 44 }} aria-label={`Delete payment of ${lkr(p.amount)}`} onClick={() => onDelete(p)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
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
 * Staff keep the shop name, the sign-in phone and the contact details. Only changed fields are sent;
 * a number another account uses is refused (409 PHONE_IN_USE).
 */
function EditDetailsSheet({ seller, onClose, onSaved }: { seller: AdminSeller; onClose(): void; onSaved(s: AdminSeller): void }) {
  const [shop, setShop] = useState(seller.shop_name);
  const [phone, setPhone] = useState(seller.phone ? readablePhone(seller.phone) : '');
  const [contact, setContact] = useState(seller.contact_name ?? '');
  const [address, setAddress] = useState(seller.address ?? '');
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
    <Sheet label="Edit seller details" title={`Edit ${seller.shop_name}`} busy={busy} submitLabel={busy ? 'Saving…' : 'Save details'} onClose={onClose} onSubmit={() => void save()}>
      <TextField label="Shop name">
        <input className="input" maxLength={80} value={shop} onChange={(e) => setShop(e.target.value)} />
      </TextField>
      <TextField label="Phone (they sign in with it)">
        <input className="input" inputMode="tel" placeholder="077 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </TextField>
      <TextField label="Contact name">
        <input className="input" maxLength={80} value={contact} onChange={(e) => setContact(e.target.value)} />
      </TextField>
      <TextField label="Address">
        <input className="input" maxLength={255} value={address} onChange={(e) => setAddress(e.target.value)} />
      </TextField>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

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
  if (state === null) return <p className="sellers-card__meta">Loading…</p>;
  if ('notReady' in state) return <p className="sellers-card__meta">Available after the next database update.</p>;
  if ('error' in state) return <p className="sellers-card__meta">{state.error}</p>;
  return state.rows.length === 0 ? <p className="sellers-card__meta">{empty}</p> : null;
}

/**
 * The seller's waiting payout request (migration 057). Paying records the payout in the ledger
 * (same as Record payment) and notifies the seller in the app; declining needs a reason, which is sent too.
 */
function PayoutRequestsSection({ seller, onPaid, onNotify }: { seller: AdminSeller; onPaid(s: SellerStatement): void; onNotify: Notify }) {
  const today = colomboTodayDay();
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
      onNotify(`Paid ${lkr(req.amount)} and recorded it.`);
    } catch (err) {
      setError(notReady(err) ? NOT_READY_TEXT : errorMessage(err, 'Could not record the payment.'));
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
      onNotify('Payout request declined.');
    } catch (err) {
      setError(notReady(err) ? NOT_READY_TEXT : errorMessage(err, 'Could not decline the request.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Payout requests">
      <h2 className="growth-card__title">Payout requests</h2>
      <ListState state={state} empty="No payout request waiting." />
      {rows.map((r) => (
        <div key={r.id} className="seller-request" role="group" aria-label={`Payout request of ${lkr(r.amount)}`}>
          <dl className="seller-facts">
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
              <dd>{dayText(r.created_at)}</dd>
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
          {r.amount > r.due ? <p className="seller-warn">This is more than is due now: decline it and let the seller ask again.</p> : null}
          <div className="sellers-actions">
            <button
              type="button"
              className="button button--ink"
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
              className="button"
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
        <Sheet
          label="Pay the seller"
          title={`Paid ${lkr(paying.amount)}?`}
          message={`Pay ${seller.shop_name} yourself (${METHOD_LABEL[paying.method].toLowerCase()}), then record it here. It is added to the payments and the seller gets an app notification.`}
          busy={busy}
          submitLabel={busy ? 'Recording…' : 'Record payment'}
          onClose={() => setPaying(null)}
          onSubmit={() => void pay(paying)}
        >
          <TextField label="Paid on">
            <input className="input" type="date" aria-label="Paid on date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </TextField>
          <TextField label="Note (optional)" error={error}>
            <input className="input" aria-label="Payout note" maxLength={200} placeholder="Transfer ref 1234" value={note} onChange={(e) => setNote(e.target.value)} />
          </TextField>
        </Sheet>
      ) : null}

      {declining ? (
        <Sheet
          label="Decline payout request"
          title={`Decline ${lkr(declining.amount)}?`}
          busy={busy}
          submitLabel={busy ? 'Declining…' : 'Decline'}
          submitTone="danger"
          submitDisabled={!reason.trim()}
          onClose={() => setDeclining(null)}
          onSubmit={() => void decline(declining)}
        >
          <TextField label="Reason (sent to the seller as an app notification)" error={error}>
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
          </TextField>
        </Sheet>
      ) : null}
    </section>
  );
}
