import { useCallback, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { deliveriesApi } from '../api/resources';
import type { DeliverySummary, PickupPoint } from '../api/types';
import { Banner } from '../components/Banner';
import { Header } from '../components/Header';
import { HomeTipNotice } from '../components/TipNotice';
import { isPaidByWallet, isPaidOnline, nextAction, PAID_BY_WALLET_NOTE, PAID_ONLINE_NOTE, splitQueue, statusLabel, statusTone } from '../lib/delivery';
import { errorMessage } from '../lib/errors';
import { pickupListLine, sellerPickups, usePickups } from '../lib/pickups';
import { formatMoney, formatScheduledSlot, shortOrderNumber } from '../lib/format';
import { syncTrackingFromList } from '../lib/tracker-session';
import { formatAway, formatByRoad, isTripStop, orderTrip, useRiderPosition, useRoadOrder, type TripStop } from '../lib/trip';
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

  // Seller orders (owner, 2026-10-30): which shop to collect from, and whether it is ready.
  const pickups = usePickups(data ?? null);
  const queue = data ? splitQueue(data) : null;
  // Rider trips: two or more orders to act on are one trip, shown as its
  // stops in order. A single delivery keeps the ordinary "Now" slip.
  const tripCount = data ? data.filter(isTripStop).length : 0;
  const position = useRiderPosition(tripCount >= 2);
  // Stops on the road in road order (OSRM via the API) when it answers.
  const road = useRoadOrder(data ?? null, position, tripCount >= 2);
  const trip = data && tripCount >= 2 ? orderTrip(data, position, road) : null;
  const inTrip = new Set(trip?.map((s) => s.delivery.delivery_id) ?? []);
  const rest = queue ? queue.next.filter((d) => !inTrip.has(d.delivery_id)) : [];
  // Set by the delivery screen when it had to send the rider back here.
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  return (
    <>
      <Header onRefresh={refresh} refreshing={loading} refreshLabel="Refresh deliveries" />
      <main className="page">
        {notice ? <Banner message={notice} /> : null}
        {/* "You received a tip" (owner, 2026-10-24): best effort, never blocks the list. */}
        <HomeTipNotice />
        {error ? <Banner message={errorMessage(error)} stamp={data ? loadedAt : null} onRetry={refresh} /> : null}

        {!queue && !error ? (
          <p className="page__loading" role="status">
            Loading your deliveries…
          </p>
        ) : null}

        {queue ? (
          <>
            {trip ? (
              <TripView stops={trip} pickups={pickups} />
            ) : queue.now ? (
              <NowSlip delivery={queue.now} pickups={pickups.get(queue.now.delivery_id)} />
            ) : null}

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
                          <PickupLine pickups={pickups.get(d.delivery_id)} className="row__pickup" />
                          {/* Scheduled slot, when the customer picked one (owner, 2026-10-10). */}
                          {formatScheduledSlot(d.scheduled_for, d.scheduled_until) ? (
                            <span className="row__slot">{formatScheduledSlot(d.scheduled_for, d.scheduled_until)}</span>
                          ) : null}
                        </span>
                        <span className="row__amount">
                          {isPaidOnline(d) ? 'Paid online' : isPaidByWallet(d) ? 'Paid by wallet' : formatMoney(d.total_amount)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* My day lives here, away from Sign out (owner, 2026-10-09). */}
            <Link to="/day" className="day-card" aria-label="My day">
              <span className="day-card__text">
                <span className="day-card__title">My day</span>
                <span className="day-card__sub">Deliveries, cash and earnings</span>
              </span>
              <span className="day-card__arrow" aria-hidden="true">
                ›
              </span>
            </Link>

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

/** "At <shop>" while the seller prepares the order, green "Ready at <shop>" once it is ready. */
function PickupLine({ pickups, className }: { pickups: PickupPoint[] | undefined; className: string }) {
  const line = pickupListLine(pickups);
  if (!line) return null;
  return (
    <span className={`${className} pickup-line pickup-line--${line.ready ? 'ready' : 'preparing'}`} data-testid="pickup-line">
      {line.text}
    </span>
  );
}

function NowSlip({ delivery: d, pickups }: { delivery: DeliverySummary; pickups: PickupPoint[] | undefined }) {
  const number = shortOrderNumber(d.order_number);
  const slot = formatScheduledSlot(d.scheduled_for, d.scheduled_until);
  return (
    <section className="slip" aria-labelledby="now-heading">
      <div className="slip__top">
        <h2 id="now-heading" className="eyebrow eyebrow--strong">
          Now
        </h2>
        <span className={`slip__state tone--${statusTone(d)}`}>{statusLabel(d)}</span>
      </div>
      <PickupLine pickups={pickups} className="slip__pickup" />
      <p className="slip__dest">{d.delivery_address_line1}</p>
      {d.delivery_address_line2 ? <p className="slip__dest-2">{d.delivery_address_line2}</p> : null}
      <p className="slip__meta">
        <span className="mono">#{number}</span>
        <span>{d.delivery_recipient_name}</span>
        <span>{d.delivery_city}</span>
      </p>
      {/* Scheduled slot, when the customer picked one (owner, 2026-10-10). */}
      {slot ? <p className="slot">{slot}</p> : null}
      {owesCash(d) && isPaidByWallet(d) ? (
        <p className="slip__cash slip__cash--paid">{PAID_BY_WALLET_NOTE}</p>
      ) : owesCash(d) ? (
        <p className="slip__cash">
          <span className="slip__cash-label">Cash to collect</span>
          <span className="slip__cash-amount">{formatMoney(d.total_amount)}</span>
        </p>
      ) : isPaidOnline(d) ? (
        <p className="slip__cash slip__cash--paid">{PAID_ONLINE_NOTE}</p>
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
 * in order: at the door, then on the road (road order when known, else
 * nearest first), then still at the store (lib/trip.ts).
 */
function TripView({ stops, pickups }: { stops: TripStop[]; pickups: Map<string, PickupPoint[]> }) {
  const toPickUp = stops.filter((s) => nextAction(s.delivery).kind === 'pickUp').length;
  // A seller's order is collected at the shop, not the store.
  const atShops = stops.some((s) => nextAction(s.delivery).kind === 'pickUp' && sellerPickups(pickups.get(s.delivery.delivery_id)).length > 0);
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
        <p className="slip__note">
          {atShops ? `Pick up all ${toPickUp} orders (store and shops) before you leave.` : `Pick up all ${toPickUp} orders at the store before you leave.`}
        </p>
      ) : toPickUp === 1 && stops.length > 1 ? (
        <p className="slip__note">
          {atShops ? 'One order is still to pick up. Collect it when you are there.' : 'One order is still at the store. Pick it up when you are there.'}
        </p>
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
              <PickupLine pickups={pickups.get(d.delivery_id)} className="slip__pickup" />
              <p className="slip__dest">{d.delivery_address_line1}</p>
              <p className="slip__meta">
                <span className="mono">#{number}</span>
                <span>{d.delivery_recipient_name}</span>
                {s.distanceM !== null ? <span>{formatAway(s.distanceM)}</span> : <span>{d.delivery_city}</span>}
                {s.roadMin !== null ? <span>{formatByRoad(s.roadMin)}</span> : null}
              </p>
              {/* Scheduled slot, when the customer picked one (owner, 2026-10-10). */}
              {formatScheduledSlot(d.scheduled_for, d.scheduled_until) ? (
                <p className="slot">{formatScheduledSlot(d.scheduled_for, d.scheduled_until)}</p>
              ) : null}
              {owesCash(d) && isPaidByWallet(d) ? (
                <p className="slip__cash slip__cash--paid">{PAID_BY_WALLET_NOTE}</p>
              ) : owesCash(d) ? (
                <p className="slip__cash">
                  <span className="slip__cash-label">Cash to collect</span>
                  <span className="slip__cash-amount">{formatMoney(d.total_amount)}</span>
                </p>
              ) : isPaidOnline(d) ? (
                <p className="slip__cash slip__cash--paid">{PAID_ONLINE_NOTE}</p>
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
