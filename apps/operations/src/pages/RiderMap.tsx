import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { orders as ordersApi, riders as ridersApi } from '../api/resources';
import type { LiveRider, LiveRiderMap, LiveWaitingOrder } from '../api/types';
import { PageHeader } from '../components/Layout';
import { RiderMapView, type MapSelection } from '../components/RiderMapView';
import { Spinner } from '../components/ui';
import { errorCode, errorMessage } from '../lib/errors';
import { shortNumber } from '../lib/orders';
import {
  ASSIGN_REFUSALS,
  RIDER_MAP_REFRESH_MS,
  TONE_LABEL,
  ageText,
  initials,
  kmText,
  ordersForRider,
  ridersForOrder,
  ridersWithoutPosition,
  riderName,
  riderTone,
  summaryText,
  waitText,
} from '../lib/riderMap';

/**
 * Rider map (owner, 2026-10-25): where the riders are, which orders wait for one, and an
 * "Assign here" that uses the ordinary manual assignment. Refreshes every 15 s while the screen is
 * visible (paused when the app is in the background). A rider's position is only known while a
 * delivery has been on the road, so a rider with no recent delivery is listed without a dot.
 */
export function RiderMap() {
  const [data, setData] = useState<LiveRiderMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [selected, setSelected] = useState<MapSelection>(null);
  const [focus, setFocus] = useState(0);
  const [busy, setBusy] = useState(false);
  const [assignError, setAssignError] = useState<{ message: string; far: { orderId: string; riderId: string } | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await ridersApi.live();
      if (!alive.current) return;
      setData(next);
      setLoadedAt(Date.now());
      setError(null);
    } catch (err) {
      if (alive.current) setError(errorMessage(err, 'Could not load the rider map.'));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(refreshIfVisible, RIDER_MAP_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [load]);

  // A selected rider or order that is gone after a refresh (assigned, delivered) closes the sheet.
  const rider = data && selected?.kind === 'rider' ? data.riders.find((r) => r.id === selected.id) ?? null : null;
  const order = data && selected?.kind === 'order' ? data.unassigned_orders.find((o) => o.order_id === selected.id) ?? null : null;
  const carried = data && selected?.kind === 'order' && !order ? findCarried(data, selected.id) : null;
  const sheetOpen = Boolean(rider || order || carried);

  function select(next: MapSelection) {
    setAssignError(null);
    setNotice(null);
    setSelected((cur) => (cur && next && cur.kind === next.kind && cur.id === next.id ? null : next));
  }

  async function assign(orderId: string, riderId: string, confirmFar = false) {
    setBusy(true);
    setAssignError(null);
    setNotice(null);
    try {
      await ordersApi.assignRider(orderId, riderId, confirmFar);
      const o = data?.unassigned_orders.find((x) => x.order_id === orderId);
      const r = data?.riders.find((x) => x.id === riderId);
      setNotice(`Order ${o ? shortNumber(o.order_number) : ''} assigned to ${r ? riderName(r) : 'the rider'}.`.replace('  ', ' '));
      setSelected(null);
      await load();
    } catch (err) {
      const code = errorCode(err);
      setAssignError({
        message: (code && ASSIGN_REFUSALS[code]) || errorMessage(err, 'Could not assign this order.'),
        far: code === 'BATCH_DROPOFFS_TOO_FAR' ? { orderId, riderId } : null,
      });
      // Someone else changed things: show the current picture.
      if (code === 'ORDER_ALREADY_ASSIGNED' || code === 'ORDER_NOT_READY_FOR_ASSIGNMENT' || code === 'RIDER_AT_CAPACITY') void load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Rider map"
        description="Riders and orders waiting for one. Tap a dot or a pin. Refreshes every 15 seconds."
      />

      {error ? (
        <p className="field__error" role="alert">
          {error}{' '}
          <button type="button" className="button button--ghost button--sm" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : null}
      {!data && !error ? <Spinner label="Loading the rider map" /> : null}
      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}

      {data ? (
        <>
          <div className="rmap__bar">
            <p className="rmap__summary" role="status">
              {summaryText(data)}
              {loadedAt ? ` · updated ${new Date(loadedAt).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
            </p>
            <div className="rmap__sheet-actions">
              <button type="button" className="button button--ghost button--sm" onClick={() => setFocus((n) => n + 1)}>
                Centre on store
              </button>
              <button type="button" className="button button--ghost button--sm" onClick={() => void load()}>
                Refresh
              </button>
            </div>
          </div>

          <RiderMapView data={data} selected={selected} onSelect={select} focus={focus} />

          <ul className="rmap__legend" aria-label="Map key">
            <li><span className="rmap__swatch rmap__swatch--free" aria-hidden="true" /> Free rider</li>
            <li><span className="rmap__swatch rmap__swatch--trip" aria-hidden="true" /> On a trip</li>
            <li><span className="rmap__swatch rmap__swatch--stale" aria-hidden="true" /> Not seen for 3 min</li>
            <li><span className="rmap__swatch rmap__swatch--waiting" aria-hidden="true" /> Order waiting</li>
            <li><span className="rmap__swatch rmap__swatch--assigned" aria-hidden="true" /> Order with a rider</li>
          </ul>

          <p className="page__note">
            A rider's dot is the last point their phone sent, which it does while a delivery is on the road.
            {data.auto_assign.enabled ? (
              <>
                {' '}
                Automatic assignment is on: after {data.auto_assign.wait_seconds} s an order goes to a rider within{' '}
                {data.auto_assign.max_distance_km} km. <Link className="link" to="/more#rider-auto-assign">Change</Link>
              </>
            ) : (
              <>
                {' '}
                Automatic assignment is off. <Link className="link" to="/more#rider-auto-assign">Turn it on</Link>
              </>
            )}
          </p>

          <section className="section" aria-labelledby="rmap-waiting">
            <h2 className="section-label" id="rmap-waiting">
              Orders waiting for a rider · {data.unassigned_orders.length}
            </h2>
            {data.unassigned_orders.length === 0 ? (
              <p className="quiet">Every packed order has a rider.</p>
            ) : (
              <ul className="rmap__list">
                {data.unassigned_orders.map((o) => (
                  <li key={o.order_id}>
                    <button
                      type="button"
                      className={order?.order_id === o.order_id ? 'rmap__row is-selected' : 'rmap__row'}
                      aria-pressed={order?.order_id === o.order_id}
                      onClick={() => select({ kind: 'order', id: o.order_id })}
                    >
                      <span className="rmap__row-main">
                        <span className="rmap__row-title">Order {shortNumber(o.order_number)}</span>
                        <span className="rmap__row-meta">
                          {o.address || 'No address'} · waiting {waitText(o.waiting_seconds)}
                          {o.dropoff ? '' : ' · no map pin'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="section" aria-labelledby="rmap-riders">
            <h2 className="section-label" id="rmap-riders">
              Riders · {data.riders.length}
            </h2>
            {data.riders.length === 0 ? (
              <p className="quiet">No active riders.</p>
            ) : (
              <ul className="rmap__list">
                {data.riders.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={rider?.id === r.id ? 'rmap__row is-selected' : 'rmap__row'}
                      aria-pressed={rider?.id === r.id}
                      onClick={() => select({ kind: 'rider', id: r.id })}
                    >
                      <span className={`rmap__badge rmap__badge--${riderTone(r)}`} aria-hidden="true">
                        {initials(riderName(r))}
                      </span>
                      <span className="rmap__row-main">
                        <span className="rmap__row-title">{riderName(r)}</span>
                        <span className="rmap__row-meta">{riderLine(r)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {ridersWithoutPosition(data).length > 0 ? (
              <p className="quiet">Riders without a dot have not sent a position yet.</p>
            ) : null}
          </section>

          {sheetOpen ? <div className="rmap__spacer" aria-hidden="true" /> : null}
          {rider ? (
            <RiderSheet
              rider={rider}
              waiting={data.unassigned_orders}
              busy={busy}
              assignError={assignError}
              onAssign={assign}
              onClose={() => setSelected(null)}
            />
          ) : null}
          {order ? (
            <OrderSheet
              order={order}
              riders={data.riders}
              busy={busy}
              assignError={assignError}
              onAssign={assign}
              onClose={() => setSelected(null)}
            />
          ) : null}
          {carried ? <CarriedSheet carried={carried} onClose={() => setSelected(null)} /> : null}
        </>
      ) : null}
    </div>
  );
}

/** "Free · seen 40 s ago", "On a trip, 1 of 2 · not seen lately (6 min ago)", "No position yet". */
function riderLine(r: LiveRider): string {
  const load = r.status === 'ON_TRIP' ? `On a trip, ${r.open_deliveries} of ${r.open_deliveries + r.capacity_left}` : 'Free';
  if (!r.position) return `${load} · no position yet`;
  const tone = riderTone(r);
  return `${load} · ${tone === 'stale' ? `not seen lately (${ageText(r.position.age_seconds)})` : `seen ${ageText(r.position.age_seconds)}`}`;
}

function findCarried(data: LiveRiderMap, orderId: string) {
  for (const r of data.riders) {
    const d = r.deliveries.find((x) => x.order_id === orderId);
    if (d) return { rider: r, delivery: d };
  }
  return null;
}

type AssignError = { message: string; far: { orderId: string; riderId: string } | null } | null;

function AssignProblem({ error, busy, onAssign }: { error: AssignError; busy: boolean; onAssign(orderId: string, riderId: string, confirmFar?: boolean): void }) {
  if (!error) return null;
  return (
    <div role="alert">
      <p className="field__error">{error.message}</p>
      {error.far ? (
        <button type="button" className="button button--sm" disabled={busy} onClick={() => onAssign(error.far!.orderId, error.far!.riderId, true)}>
          Add to the trip anyway
        </button>
      ) : null}
    </div>
  );
}

function RiderSheet({
  rider,
  waiting,
  busy,
  assignError,
  onAssign,
  onClose,
}: {
  rider: LiveRider;
  waiting: LiveWaitingOrder[];
  busy: boolean;
  assignError: AssignError;
  onAssign(orderId: string, riderId: string, confirmFar?: boolean): void;
  onClose(): void;
}) {
  const tone = riderTone(rider);
  const options = ordersForRider(rider, waiting);
  return (
    <section className="rmap__sheet" role="dialog" aria-label={`Rider ${riderName(rider)}`}>
      <div className="rmap__sheet-head">
        <div>
          <h2 className="rmap__sheet-title">{riderName(rider)}</h2>
          <p className="rmap__row-meta">
            {TONE_LABEL[tone]} · {riderLine(rider)}
          </p>
        </div>
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="rmap__row-meta">
        {rider.vehicle_type.toLowerCase()} ·{' '}
        {rider.capacity_left > 0
          ? `${rider.capacity_left} more ${rider.capacity_left === 1 ? 'order' : 'orders'} can be added`
          : 'at the trip limit'}
        {rider.position?.accuracy_m ? ` · accurate to about ${Math.round(rider.position.accuracy_m)} m` : ''}
      </p>
      {rider.phone ? (
        <p className="rmap__row-meta">
          <a className="link" href={`tel:${rider.phone}`}>
            Call {rider.phone}
          </a>
        </p>
      ) : null}
      {rider.deliveries.length > 0 ? (
        <>
          <h3 className="section-label">Carrying</h3>
          <ul className="rmap__list">
            {rider.deliveries.map((d) => (
              <li key={d.order_id} className="rmap__row">
                <span className="rmap__row-main">
                  <Link className="rmap__row-title link" to={`/orders/${d.order_id}`}>
                    Order {shortNumber(d.order_number)}
                  </Link>
                  <span className="rmap__row-meta">{d.assignment_status.toLowerCase().replace(/_/g, ' ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className="section-label">Waiting orders</h3>
      {options.length === 0 ? (
        <p className="quiet">No order is waiting for a rider.</p>
      ) : (
        <ul className="rmap__list">
          {options.map(({ order, km }) => (
            <li key={order.order_id} className="rmap__row">
              <span className="rmap__row-main">
                <span className="rmap__row-title">Order {shortNumber(order.order_number)}</span>
                <span className="rmap__row-meta">
                  {order.address || 'No address'} · waiting {waitText(order.waiting_seconds)}
                  {km !== null ? ` · ${kmText(km)} from ${riderName(rider).split(' ')[0]}` : ''}
                </span>
              </span>
              <button
                type="button"
                className="button button--sm rmap__assign"
                disabled={busy || rider.capacity_left < 1}
                aria-label={`Assign order ${shortNumber(order.order_number)} to ${riderName(rider)}`}
                onClick={() => onAssign(order.order_id, rider.id)}
              >
                Assign here
              </button>
            </li>
          ))}
        </ul>
      )}
      <AssignProblem error={assignError} busy={busy} onAssign={onAssign} />
    </section>
  );
}

function OrderSheet({
  order,
  riders,
  busy,
  assignError,
  onAssign,
  onClose,
}: {
  order: LiveWaitingOrder;
  riders: LiveRider[];
  busy: boolean;
  assignError: AssignError;
  onAssign(orderId: string, riderId: string, confirmFar?: boolean): void;
  onClose(): void;
}) {
  const options = ridersForOrder(order, riders);
  return (
    <section className="rmap__sheet" role="dialog" aria-label={`Order ${shortNumber(order.order_number)}`}>
      <div className="rmap__sheet-head">
        <div>
          <h2 className="rmap__sheet-title">Order {shortNumber(order.order_number)}</h2>
          <p className="rmap__row-meta">
            Waiting {waitText(order.waiting_seconds)} for a rider · {order.address || 'No address'}
          </p>
        </div>
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="rmap__row-meta">
        <Link className="link" to={`/orders/${order.order_id}`}>
          Open the order
        </Link>
      </p>
      <h3 className="section-label">Riders</h3>
      {options.length === 0 ? (
        <p className="quiet">No active riders.</p>
      ) : (
        <ul className="rmap__list">
          {options.map(({ rider, tone, km, canTake }) => (
            <li key={rider.id} className="rmap__row">
              <span className={`rmap__badge rmap__badge--${tone}`} aria-hidden="true">
                {initials(riderName(rider))}
              </span>
              <span className="rmap__row-main">
                <span className="rmap__row-title">{riderName(rider)}</span>
                <span className="rmap__row-meta">
                  {riderLine(rider)}
                  {km !== null ? ` · ${kmText(km)} from the drop` : ''}
                </span>
              </span>
              <button
                type="button"
                className="button button--sm rmap__assign"
                disabled={busy || !canTake}
                aria-label={`Assign order ${shortNumber(order.order_number)} to ${riderName(rider)}`}
                onClick={() => onAssign(order.order_id, rider.id)}
              >
                Assign here
              </button>
            </li>
          ))}
        </ul>
      )}
      <AssignProblem error={assignError} busy={busy} onAssign={onAssign} />
    </section>
  );
}

function CarriedSheet({ carried, onClose }: { carried: NonNullable<ReturnType<typeof findCarried>>; onClose(): void }) {
  const { rider, delivery } = carried;
  return (
    <section className="rmap__sheet" role="dialog" aria-label={`Order ${shortNumber(delivery.order_number)}`}>
      <div className="rmap__sheet-head">
        <div>
          <h2 className="rmap__sheet-title">Order {shortNumber(delivery.order_number)}</h2>
          <p className="rmap__row-meta">
            With {riderName(rider)} · {delivery.assignment_status.toLowerCase().replace(/_/g, ' ')}
          </p>
        </div>
        <button type="button" className="button button--ghost button--sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="rmap__row-meta">
        <Link className="link" to={`/orders/${delivery.order_id}`}>
          Open the order
        </Link>
      </p>
    </section>
  );
}
