import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { delivery as deliveryApi } from '../../api/resources';
import type { DeliveryDetail } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { TrackingStatus } from '../../components/TrackingStatus';
import { DeliveryMap } from '../../components/DeliveryMap';
import { toLatLng } from '../../lib/route';
import { canReportFailure, deliveryErrorMessage, isTrackable, nextAction, stage } from '../../lib/delivery';
import { errorCode } from '../../lib/errors';
import { formatClock, formatMoney, shortNumber } from '../../lib/orders';
import { formatPhone } from '../../lib/format';
import { getTracker, stopTrackingFor, syncTracking } from '../../lib/tracker-session';
import type { TrackingState } from '../../lib/tracking';

const FAILURE_REASON_MAX = 500;
/** Only stages 0-2 are ever shown here - stage 3 (DELIVERED) always takes
 * the `done` branch above before this is read. */
const STAGE_LABEL: Record<number, string> = { 0: 'Pick up', 1: 'On the way', 2: 'Handover' };

/**
 * One delivery - the operator's equivalent of Rider's own Delivery.tsx
 * (ported, not imported - common.md rule 2), on Operations' own
 * `/delivery/:id` route (registered here, per F2's coordination note in
 * task-F2-report.md §9 - Home's "Open delivery" link already targets this
 * exact path/shape).
 *
 * Live-location tracking is entirely foreground-only browser Geolocation
 * (common.md rule 10) and is owned by THIS screen alone: it starts only when
 * the loaded delivery is genuinely in its trackable window
 * (`lib/delivery.ts`'s `isTrackable`, mirroring the backend's own check) and
 * is explicitly stopped when this screen unmounts - a deliberate difference
 * from the Rider app's ambient, screen-independent tracker session (see
 * `lib/tracker-session.ts`'s own doc comment for why).
 */
export function Detail() {
  const { id = '' } = useParams();
  const { refreshRiderCapability } = useAuth();
  const [data, setData] = useState<DeliveryDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [needsRiderProfile, setNeedsRiderProfile] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'collect' | 'fail' | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const detail = await deliveryApi.detail(id);
      setData(detail);
      setLoadError(null);
    } catch (err) {
      const code = errorCode(err);
      // Wrong rider, a non-existent id (404 DELIVERY_NOT_FOUND) or a
      // malformed one (400 VALIDATION_ERROR - deliveryParamsSchema.uuid() on
      // the :id param, rejected before any ownership check even runs): all
      // three render the identical, honest not-found state - never a
      // permissions-flavoured error, and never a hint that distinguishes
      // "wrong rider" from "doesn't exist" (common.md rule 5 - existence
      // must never leak).
      if (code === 'DELIVERY_NOT_FOUND' || (err instanceof ApiError && err.status === 400 && code === 'VALIDATION_ERROR')) {
        setNotFound(true);
        await stopTrackingFor(id);
        return;
      }
      if (code === 'RIDER_PROFILE_NOT_FOUND' || code === 'RIDER_INACTIVE') {
        setNeedsRiderProfile(true);
        await refreshRiderCapability();
        return;
      }
      setLoadError(deliveryErrorMessage(err));
    }
  }, [id, refreshRiderCapability]);

  useEffect(() => {
    void load();
  }, [load]);

  // The tracker is owned by this screen (unlike Rider's app-level session -
  // see lib/tracker-session.ts's doc comment): every load/action that
  // changes `data` re-syncs it against the delivery's real trackable state,
  // and unmounting always stops it, whatever that state is.
  const [trackingState, setTrackingState] = useState<TrackingState>(() => getTracker().getState());
  useEffect(() => {
    const tracker = getTracker();
    setTrackingState(tracker.getState());
    return tracker.subscribe(setTrackingState);
  }, []);
  useEffect(() => {
    // A plugin start/stop that throws must never become an unhandled rejection.
    if (data) syncTracking(data).catch(() => undefined);
  }, [data]);
  useEffect(
    () => () => {
      void stopTrackingFor(id);
    },
    [id]
  );

  /** Runs one step. A single request at a time, whatever is tapped. */
  async function run(step: () => Promise<DeliveryDetail | void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await step();
      if (updated) setData(updated);
      else await load();
      setDialog(null);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DELIVERY_NOT_FOUND') {
        setNotFound(true);
        await stopTrackingFor(id);
        return;
      }
      if (code === 'RIDER_PROFILE_NOT_FOUND' || code === 'RIDER_INACTIVE') {
        setNeedsRiderProfile(true);
        await refreshRiderCapability();
        return;
      }
      setNotice(deliveryErrorMessage(err));
      // The backend refused because the delivery moved on, or the result is
      // unknown: show the delivery as it is now rather than offering the
      // same button again.
      const stale = err instanceof ApiError && (err.status === 409 || code === 'INVALID_COD_AMOUNT');
      if (stale || code === 'TIMEOUT') {
        setDialog(null);
        await load();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (needsRiderProfile) {
    return (
      <div className="page">
        <Link to="/delivery" className="link">
          ← Back to Delivery
        </Link>
        <p className="banner banner--muted" role="status">
          No rider profile is linked to this account yet.
        </p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page">
        <Link to="/delivery" className="link">
          ← Back to Delivery
        </Link>
        <p className="orders__empty">Delivery not found.</p>
        <p className="page__note">This delivery is no longer assigned to you.</p>
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <div className="page">
        <Link to="/delivery" className="link">
          ← Back to Delivery
        </Link>
        <p className="field__error">{loadError}</p>
        <button type="button" className="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <Link to="/delivery" className="link">
          ← Back to Delivery
        </Link>
        <p className="loading" role="status">
          Loading the delivery…
        </p>
      </div>
    );
  }

  const action = nextAction(data);
  const done = action.kind === 'none' && action.reason === 'done';
  const closed = action.kind === 'none' && (action.reason === 'cancelled' || action.reason === 'failed');
  const destination = toLatLng(data.delivery_latitude, data.delivery_longitude);
  const canFail = canReportFailure(data);
  const number = shortNumber(data.order_number);

  return (
    <div className="page order-detail">
      <Link to="/delivery" className="link">
        ← Back to Delivery
      </Link>

      <header className="order-detail__head">
        <div>
          <p className="order-detail__number mono">#{number}</p>
          <p className="order-detail__status">{done ? 'Delivered' : closed ? 'Closed' : STAGE_LABEL[stage(data)] ?? ''}</p>
        </div>
      </header>

      {notice ? (
        <p className="field__error" role="status">
          {notice}
        </p>
      ) : null}

      {/* Through ARRIVED_AT_CUSTOMER: tracking itself ends on arrival, but
          the readout stays visible to confirm sharing has stopped. */}
      {isTrackable(data) || canFail ? <TrackingStatus state={trackingState} /> : null}

      {done ? (
        <section className="settled" aria-label="Delivered">
          <p className="order-detail__strong">{formatMoney(data.cod_collected_amount)} collected</p>
          {data.delivered_at ? <p className="order-detail__meta">at {formatClock(data.delivered_at)}</p> : null}
        </section>
      ) : null}
      {action.kind === 'none' && action.reason === 'being-packed' ? (
        <p className="page__note">The store hasn't packed this order yet. Wait for it before leaving.</p>
      ) : null}
      {action.kind === 'none' && action.reason === 'cancelled' ? (
        <p className="page__note">This order was cancelled. Don't deliver it — check with the store.</p>
      ) : null}
      {action.kind === 'none' && action.reason === 'failed' && data.failure_reason ? (
        <p className="page__note">You reported: {data.failure_reason}</p>
      ) : null}

      {/* The route to the customer while the delivery is still to be made. */}
      {destination && !done && !closed ? <DeliveryMap destination={destination} /> : null}

      <section className="order-detail__section" aria-label="Destination">
        <h2 className="order-detail__label">Destination</h2>
        <p>{data.delivery_address_line1}</p>
        {data.delivery_address_line2 ? <p>{data.delivery_address_line2}</p> : null}
        <p>{data.delivery_city}</p>
        {data.delivery_instructions && !done ? <p className="order-detail__note">"{data.delivery_instructions}"</p> : null}
      </section>

      <section className="order-detail__section" aria-label="Customer">
        <h2 className="order-detail__label">Customer</h2>
        <p className="order-detail__strong">{data.delivery_recipient_name}</p>
        {done || closed ? null : (
          <a className="link mono" href={`tel:${data.delivery_recipient_phone}`} aria-label={`Call ${data.delivery_recipient_name}`}>
            {formatPhone(data.delivery_recipient_phone)}
          </a>
        )}
      </section>

      {data.items.length > 0 ? (
        <section className="order-detail__section" aria-label="In the bag">
          <h2 className="order-detail__label">In the bag</h2>
          <ul className="order-items">
            {data.items.map((item) => (
              <li key={item.id} className="order-items__row">
                <span className="order-items__qty mono">{item.quantity} ×</span>
                <span className="order-items__name">{item.product_name_snapshot}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.payment_method === 'COD' && data.payment_status === 'PENDING' && !closed ? (
        <section className="order-detail__section" aria-label="Cash to collect">
          <h2 className="order-detail__label">Cash to collect</h2>
          <p className="order-detail__strong">{formatMoney(data.total_amount)}</p>
        </section>
      ) : null}

      {action.kind !== 'none' || canFail ? (
        <footer className="order-detail__actions">
          {canFail ? (
            <button type="button" className="button button--ink-outline" onClick={() => setDialog('fail')} disabled={busy}>
              Can't deliver
            </button>
          ) : null}
          {action.kind === 'pickUp' ? (
            <button type="button" className="button" onClick={() => void run(() => deliveryApi.pickUp(data.delivery_id))} disabled={busy}>
              {busy ? 'Saving…' : action.label}
            </button>
          ) : null}
          {action.kind === 'arrive' ? (
            <button type="button" className="button" onClick={() => void run(() => deliveryApi.arrive(data.delivery_id))} disabled={busy}>
              {busy ? 'Saving…' : action.label}
            </button>
          ) : null}
          {action.kind === 'collect' ? (
            <button type="button" className="button" onClick={() => setDialog('collect')} disabled={busy}>
              {action.label}
            </button>
          ) : null}
        </footer>
      ) : null}

      {dialog === 'collect' && nextAction(data).kind === 'collect' ? (
        <CollectCodDialog
          amount={data.total_amount}
          recipient={data.delivery_recipient_name}
          busy={busy}
          onConfirm={() => void run(async () => void (await deliveryApi.collectCod(data.delivery_id, data.total_amount)))}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog === 'fail' && canFail ? (
        <FailDialog busy={busy} onClose={() => setDialog(null)} onSubmit={(reason) => void run(() => deliveryApi.fail(data.delivery_id, reason))} />
      ) : null}
    </div>
  );
}

/**
 * The amount is the total the API already reported for this delivery - it is
 * shown as plain text, never an editable/input field, so the operator cannot
 * fat-finger a different value; the backend independently re-validates the
 * amount under its own row lock regardless (rider.schema.ts's
 * `collectCodSchema`; common.md rule 8). This is the "confirmation step"
 * task-F4-brief.md's COD test requires.
 */
function CollectCodDialog({
  amount,
  recipient,
  busy,
  onConfirm,
  onClose,
}: {
  amount: number;
  recipient: string;
  busy: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  const titleId = useId();
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal__panel">
        <h2 className="modal__title" id={titleId}>
          Collect {formatMoney(amount)} in cash
        </h2>
        <p className="modal__message">from {recipient}. Count it before you confirm — this completes the delivery.</p>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Not yet
          </button>
          <button type="button" className="button" disabled={busy} onClick={onConfirm}>
            {busy ? 'Recording…' : 'Cash collected — complete'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FailDialog({ busy, onClose, onSubmit }: { busy: boolean; onClose(): void; onSubmit(reason: string): void }) {
  const titleId = useId();
  const fieldId = useId();
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        className="modal__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <h2 className="modal__title" id={titleId}>
          Can't deliver this order
        </h2>
        <label className="field" htmlFor={fieldId}>
          <span className="field__label">What happened?</span>
          <textarea
            id={fieldId}
            className="input"
            rows={3}
            maxLength={FAILURE_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            autoFocus
          />
        </label>
        <p className="modal__message">The store sees this. The order will be marked as not delivered.</p>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Back
          </button>
          <button type="submit" className="button button--ink" disabled={!trimmed || busy}>
            {busy ? 'Saving…' : "Mark as couldn't deliver"}
          </button>
        </div>
      </form>
    </div>
  );
}
