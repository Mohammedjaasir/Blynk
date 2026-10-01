import { useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { deliveriesApi } from '../api/resources';
import type { DeliverySummary } from '../api/types';
import { Banner } from '../components/Banner';
import { Header } from '../components/Header';
import { nextAction, splitQueue, statusLabel, statusTone } from '../lib/delivery';
import { errorMessage } from '../lib/errors';
import { formatMoney, shortOrderNumber } from '../lib/format';
import { syncTrackingFromList } from '../lib/tracker-session';
import { formatAway, isTripStop, orderTrip, useRiderPosition, type TripStop } from '../lib/trip';
import { useLoad } from '../lib/useLoad';
import { useRevalidate } from '../lib/useRevalidate';

export const owesCash = (d: DeliverySummary) => d.payment_method === 'COD' && d.payment_status === 'PENDING';

/**
 * Home answers one question: what do I act on now? The delivery furthest
 * along gets the page; the rest are one line each; today's finished work is
 * a single summary line. Everything shown comes from GET /riders/deliveries.
 */
export function Queue() {
  const { data, error, loading, loadedAt, reload } = useLoad(() => deliveriesApi.list(), []);
  const refresh = useCallback(() => void reload(), [reload]);
  useRevalidate(refresh);

  // The window belongs to the delivery, not to a screen: a cold start or a
  // restart that lands here must resume tracking, and a list showing nothing
  // on the road must stop it. `data` only changes on a successful load, so a
  // failed one starts and stops nothing.
  useEffect(() => {
    if (data) syncTrackingFromList(data).catch(() => undefined);
  }, [data]);

  const queue = data ? splitQueue(data) : null;
  // Rider trips: two or more orders to act on are one trip, shown as its
  // stops in order. A single delivery keeps the ordinary "Now" slip.
  const tripCount = data ? data.filter(isTripStop).length : 0;
  const position = useRiderPosition(tripCount >= 2);
  const trip = data && tripCount >= 2 ? orderTrip(data, position) : null;
  const inTrip = new Set(trip?.map((s) => s.delivery.delivery_id) ?? []);
  const rest = queue ? queue.next.filter((d) => !inTrip.has(d.delivery_id)) : [];
  // Set by the delivery screen when it had to send the rider back here.
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  return (
    <>
      <Header onRefresh={refresh} refreshing={loading} refreshLabel="Refresh deliveries" />
      <main className="page">
        {notice ? <Banner message={notice} /> : null}
        {error ? <Banner message={errorMessage(error)} stamp={data ? loadedAt : null} onRetry={refresh} /> : null}

        {!queue && !error ? (
          <p className="page__loading" role="status">
            Loading your deliveries…
          </p>
        ) : null}

        {queue ? (
          <>
            {trip ? <TripView stops={trip} /> : queue.now ? <NowSlip delivery={queue.now} /> : null}

            {!queue.now && queue.next.length === 0 ? (
              <section className="empty">
                <p className="empty__title">No deliveries assigned to you right now.</p>
                <p className="empty__body">
                  The store assigns deliveries. This page checks for new ones every 30 seconds.
                </p>
                <button type="button" className="secondary" onClick={refresh} disabled={loading}>
                  Check again
                </button>
              </section>
            ) : null}

            {!queue.now && queue.next.length > 0 ? (
              <p className="page__note">Nothing to pick up yet. The orders below are waiting on the store.</p>
            ) : null}

            {rest.length > 0 ? (
              <section className="list" aria-labelledby="next-heading">
                <h2 id="next-heading" className="eyebrow">
                  Next
                </h2>
                <ul className="list__rows">
                  {rest.map((d) => (
                    <li key={d.delivery_id}>
                      <Link to={`/deliveries/${d.delivery_id}`} className="row">
                        <span className="row__number">#{shortOrderNumber(d.order_number)}</span>
                        <span className="row__where">
                          <span className="row__place">{d.delivery_address_line1}</span>
                          <span className={`row__status tone--${statusTone(d)}`}>{statusLabel(d)}</span>
                        </span>
                        <span className="row__amount">{formatMoney(d.total_amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {queue.done.length > 0 ? (
              <section className="done" aria-labelledby="done-heading">
                <h2 id="done-heading" className="eyebrow">
                  Done today
                </h2>
                <p className="done__line">
                  <span className="done__tick" aria-hidden="true" />
                  {queue.done.length} delivered · {formatMoney(queue.collectedToday)} collected
                </p>
                <p className="done__numbers">
                  {queue.done.map((d) => `#${shortOrderNumber(d.order_number)}`).join('   ')}
                </p>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}

function NowSlip({ delivery: d }: { delivery: DeliverySummary }) {
  const number = shortOrderNumber(d.order_number);
  return (
    <section className="slip" aria-labelledby="now-heading">
      <div className="slip__top">
        <h2 id="now-heading" className="eyebrow eyebrow--strong">
          Now
        </h2>
        <span className={`slip__state tone--${statusTone(d)}`}>{statusLabel(d)}</span>
      </div>
      <p className="slip__dest">{d.delivery_address_line1}</p>
      {d.delivery_address_line2 ? <p className="slip__dest-2">{d.delivery_address_line2}</p> : null}
      <p className="slip__meta">
        <span className="mono">#{number}</span>
        <span>{d.delivery_recipient_name}</span>
        <span>{d.delivery_city}</span>
      </p>
      {owesCash(d) ? (
        <p className="slip__cash">
          <span className="slip__cash-label">Cash to collect</span>
          <span className="slip__cash-amount">{formatMoney(d.total_amount)}</span>
        </p>
      ) : null}
      <Link to={`/deliveries/${d.delivery_id}`} className="primary" aria-label={`Open delivery #${number}`}>
        Open delivery
      </Link>
    </section>
  );
}

/**
 * One trip, two (or more) orders: each stop is its own delivery with its own
 * handover code and cash, opened on the ordinary delivery screen. Stops are
 * in order: at the door, then nearest first on the road, then still at the
 * store (lib/trip.ts).
 */
function TripView({ stops }: { stops: TripStop[] }) {
  const toPickUp = stops.filter((s) => nextAction(s.delivery).kind === 'pickUp').length;
  const cash = stops.filter((s) => owesCash(s.delivery)).reduce((sum, s) => sum + s.delivery.total_amount, 0);
  return (
    <section className="trip" aria-labelledby="trip-heading">
      <div className="slip__top">
        <h2 id="trip-heading" className="eyebrow eyebrow--strong">
          Your trip · {stops.length} stops
        </h2>
        {cash > 0 ? <span className="trip__cash">{formatMoney(cash)} cash in all</span> : null}
      </div>
      {toPickUp > 1 ? (
        <p className="slip__note">Pick up all {toPickUp} orders at the store before you leave.</p>
      ) : toPickUp === 1 && stops.length > 1 ? (
        <p className="slip__note">One order is still at the store. Pick it up when you are there.</p>
      ) : null}
      <ol className="trip__stops">
        {stops.map((s, i) => {
          const d = s.delivery;
          const number = shortOrderNumber(d.order_number);
          return (
            <li key={d.delivery_id} className={`trip__stop${i === 0 ? ' trip__stop--first' : ''}`}>
              <div className="trip__head">
                <span className="trip__n">Stop {i + 1}</span>
                <span className={`slip__state tone--${statusTone(d)}`}>{statusLabel(d)}</span>
              </div>
              <p className="slip__dest">{d.delivery_address_line1}</p>
              <p className="slip__meta">
                <span className="mono">#{number}</span>
                <span>{d.delivery_recipient_name}</span>
                {s.distanceM !== null ? <span>{formatAway(s.distanceM)}</span> : <span>{d.delivery_city}</span>}
              </p>
              {owesCash(d) ? (
                <p className="slip__cash">
                  <span className="slip__cash-label">Cash to collect</span>
                  <span className="slip__cash-amount">{formatMoney(d.total_amount)}</span>
                </p>
              ) : null}
              <Link
                to={`/deliveries/${d.delivery_id}`}
                className={i === 0 ? 'primary' : 'secondary'}
                aria-label={`Open stop ${i + 1}, delivery #${number}`}
              >
                Open stop {i + 1}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
