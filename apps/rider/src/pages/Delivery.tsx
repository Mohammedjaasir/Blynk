import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deliveriesApi } from '../api/resources';
import type { DeliveryDetail } from '../api/types';
import { Banner } from '../components/Banner';
import { Header } from '../components/Header';
import { Sheet } from '../components/Sheet';
import { StatusRail } from '../components/StatusRail';
import { canReportFailure, nextAction, stage, statusLabel, statusTone } from '../lib/delivery';
import { MESSAGES, errorCode, errorMessage } from '../lib/errors';
import { formatMoney, formatPhone, formatTime, shortOrderNumber } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { useRevalidate } from '../lib/useRevalidate';
import { owesCash } from './Queue';

const FAILURE_REASON_MAX = 500;

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

  const leaveWith = useCallback(
    (message: string) => navigate('/', { replace: true, state: { notice: message } }),
    [navigate]
  );

  // Reassigned, or never this rider's: back to the list with the reason.
  useEffect(() => {
    if (errorCode(error) === 'DELIVERY_NOT_FOUND') leaveWith(MESSAGES.DELIVERY_NOT_FOUND);
  }, [error, leaveWith]);

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
        leaveWith(MESSAGES.DELIVERY_NOT_FOUND);
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
        {data ? <Slip delivery={data} /> : null}
      </main>

      {data ? (
        <ActionBar
          delivery={data}
          busy={busy}
          onPickUp={() => void run(() => deliveriesApi.pickUp(data.delivery_id))}
          onArrive={() => void run(() => deliveriesApi.arrive(data.delivery_id))}
          onCollect={() => setSheet('collect')}
          onFail={() => setSheet('fail')}
        />
      ) : null}

      {data && sheet === 'collect' && nextAction(data).kind === 'collect' ? (
        <Sheet title={`Collect ${formatMoney(data.total_amount)} in cash`} onClose={() => setSheet(null)}>
          <p className="sheet__body">
            from {data.delivery_recipient_name}. Count it before you confirm — this completes the delivery.
          </p>
          <div className="sheet__actions">
            <button
              type="button"
              className="primary"
              data-autofocus
              disabled={busy}
              // The amount is the total the API reported; the API rejects any other.
              onClick={() => void run(async () => void (await deliveriesApi.collectCod(data.delivery_id, data.total_amount)))}
            >
              {busy ? 'Recording…' : 'Cash collected — complete'}
            </button>
            <button type="button" className="text-button" onClick={() => setSheet(null)}>
              Not yet
            </button>
          </div>
        </Sheet>
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

function Slip({ delivery: d }: { delivery: DeliveryDetail }) {
  const action = nextAction(d);
  const done = action.kind === 'none' && action.reason === 'done';
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
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"
                  fill="currentColor"
                />
              </svg>
              <span>Call</span>
              <span className="call__number">{formatPhone(d.delivery_recipient_phone)}</span>
            </a>
          )}
        </div>
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
