import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { delivery as deliveryApi } from '../../api/resources';
import type { DeliverySummary, RiderProfile } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { RiderProfileForm } from '../../components/RiderProfileForm';
import { useAuth } from '../../auth/AuthContext';
import { deliveryErrorMessage, nextAction, splitQueue, statusLabel, statusTone } from '../../lib/delivery';
import { errorCode } from '../../lib/errors';
import { formatMoney, shortNumber } from '../../lib/orders';
import { syncTrackingFromList } from '../../lib/tracker-session';
import { formatAway, isTripStop, owesCash, tripOf, useCurrentPosition, type TripStop } from '../../lib/trip';

/** How often the queue re-reads while it is on screen and visible (matches
 * Rider's own ~30s cadence, plan §9's "no polling faster than what
 * Admin/Rider already do"). */
const REFRESH_MS = 30_000;

/**
 * Delivery Mode's queue - "what do I act on now?" (plan §11), reusing the
 * exact rider endpoints B1 widened for an operator with a linked rider
 * profile. Ported from apps/rider/src/pages/Queue.tsx's own layout (the apps
 * share no package), restyled for Operations' own `.page`/`.card`/`.ticket`
 * primitives.
 *
 * Staff riders (2026-10-01) brought it to the Rider app's parity: a
 * two-order trip is shown as its stops in order (lib/trip.ts), "My day" is
 * one tap away, and an operator with no rider profile can set one up here.
 * Every successful load also brings live-location sharing in line with the
 * list (lib/tracker-session.ts's `syncTrackingFromList`), as Rider's queue
 * does - tracking belongs to the delivery, not to a screen.
 */
export function Queue() {
  const { riderCapability, refreshRiderCapability } = useAuth();
  const [deliveries, setDeliveries] = useState<DeliverySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The device's position orders a trip's stops; asked for only when there is a trip.
  const position = useCurrentPosition((deliveries ?? []).filter(isTripStop).length >= 2);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        const list = await deliveryApi.list();
        setDeliveries(list);
        setError(null);
        // Only after a successful load: a failed one starts and stops nothing.
        syncTrackingFromList(list).catch(() => undefined);
      } catch (err) {
        const code = errorCode(err);
        if (code === 'RIDER_PROFILE_NOT_FOUND' || code === 'RIDER_INACTIVE') {
          // The rider profile this session's login-time probe confirmed may
          // have been deactivated mid-session - re-probe rather than show a
          // stale "you have delivery capability" screen.
          await refreshRiderCapability();
          return;
        }
        setError(deliveryErrorMessage(err));
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [refreshRiderCapability]
  );

  useEffect(() => {
    if (riderCapability !== 'ADMIN_PLUS_RIDER') return;
    void load(false);
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const timer = setInterval(refreshIfVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [riderCapability, load]);

  if (riderCapability === 'ADMIN_ONLY') {
    return (
      <div className="page">
        <PageHeader title="Delivery" description="Deliver orders yourself, like a rider." />
        <RiderSetup onReady={() => void refreshRiderCapability()} />
      </div>
    );
  }

  if (riderCapability === null) {
    return (
      <div className="page">
        <PageHeader title="Delivery" description="Delivery Mode" />
        <p className="loading" role="status">
          Checking delivery capability…
        </p>
      </div>
    );
  }

  const queue = deliveries ? splitQueue(deliveries) : null;
  // Two or more orders to act on are one trip, shown as its stops in order.
  // A single delivery keeps the ordinary "Now" card.
  const trip = deliveries ? tripOf(deliveries, position) : null;
  const inTrip = new Set(trip?.map((t) => t.delivery.delivery_id) ?? []);
  const rest = queue ? queue.next.filter((d) => !inTrip.has(d.delivery_id)) : [];

  return (
    <div className="page">
      <PageHeader
        title="Delivery"
        description="Your deliveries, oldest assignment first."
        actions={
          <>
            <Link to="/delivery/day" className="button button--ghost">
              My day
            </Link>
            <button type="button" className="button button--ghost" onClick={() => void load(true)} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {error ? (
        <p className="field__error" role="status">
          {error}
        </p>
      ) : null}
      {!queue && !error ? (
        <p className="loading" role="status">
          Loading your deliveries…
        </p>
      ) : null}

      {queue ? (
        <>
          {trip ? <TripCard stops={trip} /> : queue.now ? <NowCard delivery={queue.now} /> : null}

          {!queue.now && queue.next.length === 0 ? (
            <p className="attention__clear">No deliveries assigned to you right now.</p>
          ) : null}

          {!queue.now && queue.next.length > 0 ? (
            <p className="page__note">Nothing to pick up yet. The orders below are waiting on the store.</p>
          ) : null}

          {rest.length > 0 ? (
            <section className="section" aria-labelledby="queue-next-heading">
              <h2 className="section-label" id="queue-next-heading">
                Next
              </h2>
              <ul className="lane__rows">
                {rest.map((d) => (
                  <li key={d.delivery_id} className="ticket">
                    <Link to={`/delivery/${d.delivery_id}`} className="ticket__open" aria-label={`Open delivery #${shortNumber(d.order_number)}`}>
                      <span className="ticket__top">
                        <span className="ticket__number mono">#{shortNumber(d.order_number)}</span>
                      </span>
                      <span className="ticket__where">
                        <span className="ticket__place">{d.delivery_address_line1}</span>
                        <span className="ticket__who">{d.delivery_city}</span>
                      </span>
                      <span className="ticket__foot">
                        <span className={`queue-tone queue-tone--${statusTone(d)}`}>{statusLabel(d)}</span>
                        <span className="ticket__total">{formatMoney(d.total_amount)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {queue.done.length > 0 ? (
            <section className="section" aria-labelledby="queue-done-heading">
              <h2 className="section-label" id="queue-done-heading">
                Done today
              </h2>
              <p className="lane__summary">
                {queue.done.length} delivered · {formatMoney(queue.collectedToday)} collected
              </p>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function NowCard({ delivery: d }: { delivery: DeliverySummary }) {
  const number = shortNumber(d.order_number);
  return (
    <section className="card" aria-labelledby="queue-now-heading">
      <div className="delivery-card__status" id="queue-now-heading">
        {statusLabel(d)}
      </div>
      <p className="delivery-card__dest">{d.delivery_address_line1}</p>
      {d.delivery_address_line2 ? <p className="order-detail__meta">{d.delivery_address_line2}</p> : null}
      <p className="delivery-card__meta">
        <span className="mono">#{number}</span>
        <span>{d.delivery_recipient_name}</span>
        <span>{d.delivery_city}</span>
      </p>
      {owesCash(d) ? (
        <p className="delivery-card__meta">
          <span className="order-detail__strong">Cash to collect: {formatMoney(d.total_amount)}</span>
        </p>
      ) : null}
      <Link to={`/delivery/${d.delivery_id}`} className="primary" aria-label={`Open delivery #${number}`}>
        Open delivery
      </Link>
    </section>
  );
}

/**
 * One trip, two (or more) orders: each stop is its own delivery with its own
 * handover code and cash, opened on the ordinary delivery screen. Stops are
 * in order: at the door, then nearest first on the road, then still at the
 * store (lib/trip.ts). Ported from apps/rider/src/pages/Queue.tsx's TripView;
 * Home shows the same card for an operator on a trip.
 */
export function TripCard({ stops }: { stops: TripStop[] }) {
  const toPickUp = stops.filter((s) => nextAction(s.delivery).kind === 'pickUp').length;
  const cash = stops.filter((s) => owesCash(s.delivery)).reduce((sum, s) => sum + s.delivery.total_amount, 0);
  return (
    <section className="card trip" aria-labelledby="trip-heading">
      <div className="trip__top">
        <h2 id="trip-heading" className="section-label">
          Your trip · {stops.length} stops
        </h2>
        {cash > 0 ? <span className="trip__cash">{formatMoney(cash)} cash in all</span> : null}
      </div>
      {toPickUp > 1 ? (
        <p className="page__note">Pick up all {toPickUp} orders at the store before you leave.</p>
      ) : toPickUp === 1 && stops.length > 1 ? (
        <p className="page__note">One order is still at the store. Pick it up when you are there.</p>
      ) : null}
      <ol className="trip__stops">
        {stops.map((s, i) => {
          const d = s.delivery;
          const number = shortNumber(d.order_number);
          return (
            <li key={d.delivery_id} className={`trip__stop${i === 0 ? ' trip__stop--first' : ''}`}>
              <div className="trip__head">
                <span className="trip__n">Stop {i + 1}</span>
                <span className={`queue-tone queue-tone--${statusTone(d)}`}>{statusLabel(d)}</span>
              </div>
              <p className="delivery-card__dest">{d.delivery_address_line1}</p>
              <p className="delivery-card__meta">
                <span className="mono">#{number}</span>
                <span>{d.delivery_recipient_name}</span>
                {s.distanceM !== null ? <span>{formatAway(s.distanceM)}</span> : <span>{d.delivery_city}</span>}
              </p>
              {owesCash(d) ? (
                <p className="delivery-card__meta">
                  <span className="order-detail__strong">Cash to collect: {formatMoney(d.total_amount)}</span>
                </p>
              ) : null}
              <Link
                to={`/delivery/${d.delivery_id}`}
                className={i === 0 ? 'primary' : 'button trip__open'}
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

/**
 * The Delivery tab for an operator with no usable rider profile: set one up
 * (active at once), or - when an admin switched delivering off - say so.
 */
function RiderSetup({ onReady }: { onReady(): void }) {
  const [profile, setProfile] = useState<RiderProfile | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    deliveryApi
      .profile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        // Unknown: offer the form; the API refuses it if delivering is switched off.
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (profile === undefined) {
    return (
      <p className="loading" role="status">
        Checking your rider profile…
      </p>
    );
  }
  if (profile && !profile.is_active) {
    return (
      <p className="banner banner--muted" role="status">
        Delivering is switched off for your account. Ask an admin to turn "Can deliver" back on in Staff accounts.
      </p>
    );
  }
  return (
    <section className="section" aria-labelledby="rider-setup-heading">
      <p className="banner banner--muted" role="status">
        No rider profile is linked to this account yet.
      </p>
      <h2 className="section-label" id="rider-setup-heading">
        Deliver orders yourself
      </h2>
      <p className="page__note">
        Add your vehicle and the store can assign you orders. You then pick up, hand over with the customer's code and
        collect cash here, just like the Rider app.
      </p>
      <RiderProfileForm submitLabel="Start delivering" onSaved={onReady} />
    </section>
  );
}
