import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deliveriesApi } from '../api/resources';
import { DELIVERY_CODE_LENGTH, type DeliveryDetail } from '../api/types';
import { Banner } from '../components/Banner';
import { Header } from '../components/Header';
import { Sheet } from '../components/Sheet';
import { StatusRail } from '../components/StatusRail';
import { TrackingStatus } from '../components/TrackingStatus';
import { DeliveryMap } from '../components/DeliveryMap';
import { Navigation } from 'lucide-react';
import { googleMapsDirectionsUrl, toLatLng } from '../lib/route';
import { canReportFailure, isTrackable, nextAction, stage, statusLabel, statusTone } from '../lib/delivery';
import { MESSAGES, deliveryCodeLockedUntil, errorCode, errorMessage } from '../lib/errors';
import { formatMoney, formatPhone, formatTime, shortOrderNumber } from '../lib/format';
import { getTracker, stopTrackingFor, syncTracking } from '../lib/tracker-session';
import type { TrackingState } from '../lib/tracking';
import { useLoad } from '../lib/useLoad';
import { useRevalidate } from '../lib/useRevalidate';
import { owesCash } from './Queue';

const FAILURE_REASON_MAX = 500;
/** The backend's lock length, used only if a lock reply carries no timing. */
const DEFAULT_CODE_LOCK_MS = 15 * 60_000;

type CodeProblem = { kind: 'wrong' | 'locked'; message: string };

/**
 * One delivery, laid out like the slip on the bag: where it goes, who to
 * call, what is in it, the cash to collect, and one button for the next
 * step. Every step is a request the backend may refuse (another rider, a
 * cancellation, a stale screen); when it does, the screen says why and shows
 * the delivery as it now is.
 */
export function Delivery() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data, error, loading, loadedAt, reload, setData } = useLoad(() => deliveriesApi.detail(id), [id]);
  const refresh = useCallback(() => void reload(), [reload]);
  useRevalidate(refresh);

  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'collect' | 'fail' | null>(null);
  const inFlight = useRef(false);
  // A refused delivery code is answered inside the collect sheet, not behind it.
  const [codeProblem, setCodeProblem] = useState<CodeProblem | null>(null);
  const [codeLockedUntil, setCodeLockedUntil] = useState<number | null>(null);

  // The backend's lock lifts on its own; so does the disabled button.
  useEffect(() => {
    if (codeLockedUntil === null) return;
    const timer = setTimeout(() => {
      setCodeLockedUntil(null);
      setCodeProblem(null);
    }, Math.max(0, codeLockedUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [codeLockedUntil]);

  const closeSheet = () => {
    setSheet(null);
    // A lock outlives the sheet: reopening it must still say why it's disabled.
    setCodeProblem((problem) => (problem?.kind === 'locked' ? problem : null));
  };

  // The tracker is app-level (lib/tracker-session), not owned by this screen:
  // leaving mid-delivery must not stop it, and reopening must find it running.
  // This screen only reports what it knows (on mount, on every revalidation
  // and after every step, all of which change `data`) and mirrors the
  // tracker's state for the status readout. Unmounting drops the listener,
  // never the tracking.
  const [trackingState, setTrackingState] = useState<TrackingState>(() => getTracker().getState());
  useEffect(() => {
    const tracker = getTracker();
    setTrackingState(tracker.getState());
    return tracker.subscribe(setTrackingState);
  }, []);
  const trackedId = getTracker().getDeliveryId();
  useEffect(() => {
    // A plugin start/stop that throws must never become an unhandled rejection.
    if (data) syncTracking(data).catch(() => undefined);
  }, [data]);

  const leaveWith = useCallback(
    (message: string) => navigate('/', { replace: true, state: { notice: message } }),
    [navigate]
  );

  // Reassigned, or never this rider's: back to the list with the reason.
  useEffect(() => {
    if (errorCode(error) === 'DELIVERY_NOT_FOUND') {
      // Never this rider's (any more): its location window can't reopen, so
      // stop sharing if that is what the device is doing.
      stopTrackingFor(id).catch(() => undefined);
      leaveWith(MESSAGES.DELIVERY_NOT_FOUND);
    }
  }, [error, id, leaveWith]);

  /** Runs one step. A single request at a time, whatever the rider taps. */
  async function run(step: () => Promise<DeliveryDetail | void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const updated = await step();
      if (updated) setData(updated);
      else await reload();
      setSheet(null);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'DELIVERY_NOT_FOUND') {
        stopTrackingFor(id).catch(() => undefined);
        leaveWith(MESSAGES.DELIVERY_NOT_FOUND);
        return;
      }
      if (code === 'WRONG_DELIVERY_CODE') {
        // The 5th wrong code is the one that locks the handover (no tries left).
        const lockedUntil = deliveryCodeLockedUntil(err);
        if (lockedUntil !== null) {
          setCodeProblem({ kind: 'locked', message: errorMessage(err) });
          setCodeLockedUntil(lockedUntil);
          return;
        }
        setCodeProblem({ kind: 'wrong', message: errorMessage(err) });
        return;
      }
      if (code === 'DELIVERY_CODE_LOCKED') {
        setCodeProblem({ kind: 'locked', message: errorMessage(err) });
        setCodeLockedUntil(deliveryCodeLockedUntil(err) ?? Date.now() + DEFAULT_CODE_LOCK_MS);
        return;
      }
      setNotice(errorMessage(err));
      // The backend refused because the delivery moved on, or we can't know
      // whether the step landed: show the delivery as it is now rather than
      // offering the same button again.
      const stale = err instanceof ApiError && (err.status === 409 || code === 'INVALID_COD_AMOUNT');
      if (stale || code === 'TIMEOUT') {
        setSheet(null);
        await reload();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const back = (
    <Link to="/" className="bar__back" aria-label="Back to deliveries">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Deliveries
    </Link>
  );

  return (
    <>
      <Header onRefresh={refresh} refreshing={loading} refreshLabel="Refresh delivery" leading={back} />
      <main className="page page--with-bar">
        {notice ? <Banner message={notice} /> : null}
        {error && errorCode(error) !== 'DELIVERY_NOT_FOUND' ? (
          <Banner message={errorMessage(error)} stamp={data ? loadedAt : null} onRetry={refresh} />
        ) : null}
        {!data && !error ? (
          <p className="page__loading" role="status">
            Loading the delivery…
          </p>
        ) : null}
        {data ? (
          <Slip
            delivery={data}
            trackingState={trackingState}
            // Trips: after this stop closes, sharing carries on for the next one.
            trackingOtherStop={trackedId !== null && trackedId !== data.delivery_id}
          />
        ) : null}
      </main>

      {data ? (
        <ActionBar
          delivery={data}
          busy={busy}
          // The trackable window opens on pickup and closes on arrival or
          // failure; the delivery each step returns is what syncTracking reads.
          onPickUp={() => void run(() => deliveriesApi.pickUp(data.delivery_id))}
          onArrive={() => void run(() => deliveriesApi.arrive(data.delivery_id))}
          onCollect={() => setSheet('collect')}
          onFail={() => setSheet('fail')}
        />
      ) : null}

      {data && sheet === 'collect' && nextAction(data).kind === 'collect' ? (
        <CollectSheet
          delivery={data}
          busy={busy}
          problem={codeProblem}
          locked={codeLockedUntil !== null}
          onClose={closeSheet}
          onSubmit={(deliveryCode) => {
            setCodeProblem(null);
            // The amount is the total the API reported; the API rejects any other.
            void run(async () => void (await deliveriesApi.collectCod(data.delivery_id, data.total_amount, deliveryCode)));
          }}
        />
      ) : null}

      {data && sheet === 'fail' && canReportFailure(data) ? (
        <FailSheet
          busy={busy}
          onClose={() => setSheet(null)}
          onSubmit={(reason) => void run(() => deliveriesApi.fail(data.delivery_id, reason))}
        />
      ) : null}
    </>
  );
}

function Slip({
  delivery: d,
  trackingState,
  trackingOtherStop,
}: {
  delivery: DeliveryDetail;
  trackingState: TrackingState;
  trackingOtherStop: boolean;
}) {
  const action = nextAction(d);
  const done = action.kind === 'none' && action.reason === 'done';
  const destination = toLatLng(d.delivery_latitude, d.delivery_longitude);
  const closed = action.kind === 'none' && (action.reason === 'cancelled' || action.reason === 'failed');

  return (
    <article className="slip slip--detail">
      <div className="slip__top">
        <span className="slip__number">#{shortOrderNumber(d.order_number)}</span>
        {/* The rail already says where an active delivery is; words only for the exceptions. */}
        {action.kind === 'none' && !done ? (
          <span className={`slip__state tone--${statusTone(d)}`}>{statusLabel(d)}</span>
        ) : null}
      </div>
      {closed || done ? null : <StatusRail stage={stage(d)} />}
      {/* Through ARRIVED_AT_CUSTOMER (plan §2.3, §13): tracking itself ends on arrival,
          but the readout stays to confirm "Stopped sharing your location". */}
      {trackingOtherStop && !isTrackable(d) ? (
        canReportFailure(d) ? (
          <p className="tracking-status tracking-status--active">Sharing your location for your next stop.</p>
        ) : null
      ) : isTrackable(d) || canReportFailure(d) ? (
        <TrackingStatus state={trackingState} />
      ) : null}

      {done ? (
        <section className="settled" aria-label="Delivered">
          <p className="settled__title">Delivered</p>
          <p className="settled__amount">{formatMoney(d.cod_collected_amount)} collected</p>
          {d.delivered_at ? <p className="settled__time">at {formatTime(d.delivered_at)}</p> : null}
        </section>
      ) : null}
      {action.kind === 'none' && action.reason === 'being-packed' ? (
        <p className="slip__note">The store hasn't packed this order yet. Wait for it before leaving.</p>
      ) : null}
      {action.kind === 'none' && action.reason === 'cancelled' ? (
        <p className="slip__note slip__note--stop">This order was cancelled. Don't deliver it — check with the store.</p>
      ) : null}
      {action.kind === 'none' && action.reason === 'failed' && d.failure_reason ? (
        <p className="slip__note slip__note--stop">You reported: {d.failure_reason}</p>
      ) : null}

      {/* The route to the customer while the rider still has to get there. */}
      {destination && !done && !closed ? <DeliveryMap destination={destination} /> : null}
      {done || closed ? null : (
        <a
          className="navigate"
          href={googleMapsDirectionsUrl(
            destination,
            [d.delivery_address_line1, d.delivery_address_line2, d.delivery_city].filter(Boolean).join(', ')
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Navigation size={20} aria-hidden="true" />
          <span>Navigate in Google Maps</span>
        </a>
      )}

      <section className="dest" aria-label="Destination">
        <p className="dest__line1">{d.delivery_address_line1}</p>
        {d.delivery_address_line2 ? <p className="dest__line2">{d.delivery_address_line2}</p> : null}
        <p className="dest__city">{d.delivery_city}</p>
        {d.delivery_instructions && !done ? (
          <p className="dest__note">
            <span className="dest__note-label">Customer note</span>
            {d.delivery_instructions}
          </p>
        ) : null}
        <div className="dest__who">
          <span className="dest__name">{d.delivery_recipient_name}</span>
          {done || closed ? null : (
            <a
              className="call"
              href={`tel:${d.delivery_recipient_phone}`}
              aria-label={`Call ${d.delivery_recipient_name}`}
            >
              <PhoneIcon />
              <span>Call</span>
              <span className="call__number">{formatPhone(d.delivery_recipient_phone)}</span>
            </a>
          )}
        </div>
        {/* Migration 024: a second number from the address, only when given. */}
        {d.delivery_alternate_phone && !done && !closed ? (
          <div className="dest__who dest__who--alt">
            <span className="dest__alt-label">Additional phone</span>
            <a
              className="call"
              href={`tel:${d.delivery_alternate_phone}`}
              aria-label={`Call additional phone for ${d.delivery_recipient_name}`}
            >
              <PhoneIcon />
              <span>Call</span>
              <span className="call__number">{formatPhone(d.delivery_alternate_phone)}</span>
            </a>
          </div>
        ) : null}
      </section>

      {d.items.length > 0 ? (
        <section className="bag" aria-labelledby="bag-heading">
          <h2 id="bag-heading" className="eyebrow">
            In the bag
          </h2>
          <ul className="bag__items">
            {d.items.map((item) => (
              <li key={item.id} className="bag__item">
                <span className="bag__qty">{item.quantity} ×</span>
                <span className="bag__name">{item.product_name_snapshot}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {owesCash(d) && !closed ? (
        <section className={`cash${stage(d) === 2 ? ' cash--now' : ''}`} aria-label="Cash to collect">
          <span className="cash__label">Cash to collect</span>
          <span className="cash__amount">{formatMoney(d.total_amount)}</span>
        </section>
      ) : null}
    </article>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
        fill="currentColor"
      />
    </svg>
  );
}

function ActionBar({
  delivery,
  busy,
  onPickUp,
  onArrive,
  onCollect,
  onFail,
}: {
  delivery: DeliveryDetail;
  busy: boolean;
  onPickUp(): void;
  onArrive(): void;
  onCollect(): void;
  onFail(): void;
}) {
  const action = nextAction(delivery);
  const canFail = canReportFailure(delivery);
  if (action.kind === 'none' && !canFail) return null;

  const primary =
    action.kind === 'pickUp' ? onPickUp : action.kind === 'arrive' ? onArrive : action.kind === 'collect' ? onCollect : null;

  return (
    <div className="actionbar" role="group" aria-label="Delivery actions">
      {canFail ? (
        <button type="button" className="text-button actionbar__secondary" onClick={onFail} disabled={busy}>
          Can't deliver
        </button>
      ) : null}
      {primary && action.kind !== 'none' ? (
        <button type="button" className="primary" onClick={primary} disabled={busy} aria-busy={busy}>
          {busy && action.kind !== 'collect' ? 'Saving…' : action.label}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Proof of delivery: the rider types the customer's 4-digit code from their
 * Blynk app. Only the backend checks it; this sheet only collects digits.
 */
function CollectSheet({
  delivery,
  busy,
  problem,
  locked,
  onClose,
  onSubmit,
}: {
  delivery: DeliveryDetail;
  busy: boolean;
  problem: CodeProblem | null;
  locked: boolean;
  onClose(): void;
  onSubmit(deliveryCode: string): void;
}) {
  const [code, setCode] = useState('');
  const fieldId = useId();
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const complete = code.length === DELIVERY_CODE_LENGTH;

  // A wrong code is cleared so the next attempt starts clean.
  useEffect(() => {
    if (problem?.kind === 'wrong') {
      setCode('');
      input.current?.focus();
    }
  }, [problem]);

  return (
    <Sheet title={`Collect ${formatMoney(delivery.total_amount)} in cash`} onClose={onClose}>
      <form
        className="sheet__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (complete && !busy && !locked) onSubmit(code);
        }}
      >
        <p className="sheet__body">
          from {delivery.delivery_recipient_name}. Count it before you confirm — this completes the delivery.
        </p>
        <label className="field" htmlFor={fieldId}>
          <span className="field__label">Customer's delivery code</span>
          <input
            ref={input}
            id={fieldId}
            className="input input--code"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={DELIVERY_CODE_LENGTH}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, DELIVERY_CODE_LENGTH))}
            aria-describedby={hintId}
            aria-invalid={problem?.kind === 'wrong' || undefined}
            disabled={locked}
            data-autofocus
          />
        </label>
        <p className="sheet__hint" id={hintId}>
          Ask the customer for the 4-digit code in their Blynk app.
        </p>
        {problem ? (
          <p className="sheet__error" role="alert">
            {problem.message}
          </p>
        ) : null}
        <div className="sheet__actions">
          <button type="submit" className="primary" disabled={!complete || busy || locked}>
            {busy ? 'Recording…' : 'Cash collected — complete'}
          </button>
          <button type="button" className="text-button" onClick={onClose}>
            Not yet
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function FailSheet({ busy, onClose, onSubmit }: { busy: boolean; onClose(): void; onSubmit(reason: string): void }) {
  const [reason, setReason] = useState('');
  const fieldId = useId();
  const trimmed = reason.trim();
  return (
    <Sheet title="Can't deliver this order" onClose={onClose}>
      <form
        className="sheet__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSubmit(trimmed);
        }}
      >
        <label className="field" htmlFor={fieldId}>
          <span className="field__label">What happened?</span>
          <textarea
            id={fieldId}
            className="input input--area"
            rows={3}
            maxLength={FAILURE_REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-autofocus
          />
        </label>
        <p className="sheet__hint">The store sees this. The order will be marked as not delivered.</p>
        <div className="sheet__actions">
          <button type="submit" className="danger" disabled={!trimmed || busy}>
            {busy ? 'Saving…' : "Mark as couldn't deliver"}
          </button>
          <button type="button" className="text-button" onClick={onClose}>
            Back
          </button>
        </div>
      </form>
    </Sheet>
  );
}
