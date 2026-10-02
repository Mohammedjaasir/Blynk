import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { delivery as deliveryApi, dental as dentalApi, orders as ordersApi, riders as ridersApi } from '../api/resources';
import type { AdminAppointment, DeliverySummary, HomeOrder, HomeRider } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { useLowStock } from '../components/LowStock';
import { splitQueue, statusLabel } from '../lib/delivery';
import { errorMessage } from '../lib/errors';
import { formatMoney } from '../lib/orders';
import { syncTrackingFromList } from '../lib/tracker-session';
import { isTripStop, owesCash, tripOf, useCurrentPosition } from '../lib/trip';
import { TripCard } from './Delivery/Queue';

/**
 * Operations Home (plan §9). Modelled on Admin's own `Dashboard.tsx` doc
 * comment - "an operations summary, not a wall of metric tiles: one line of
 * figures across the top, then only the things that actually need a
 * decision... every number is counted from the real API" - adapted to F1's
 * mobile-first single-column `Layout` instead of Admin's sidebar. Every
 * section below is sourced from a real existing endpoint added to
 * `resources.ts`'s `orders`/`riders`/`dental` blocks; no figure here is a
 * fabricated aggregate (common.md rule 7). No polling: a manual "Refresh"
 * button reloads on demand (brief's explicit preference over tight polling
 * for a web app where pull-to-refresh isn't native).
 */

/** Deliveries whose work is finished; everything else counts as "active"
 * for the one-line "what am I doing right now" card. */
const CLOSED_ASSIGNMENT_STATUSES = new Set(['DELIVERED', 'FAILED']);

/** Asia/Colombo is UTC+05:30 all year (no daylight saving) - the same
 * offset trick Admin's own `startOfTodayColombo` uses
 * (apps/admin/src/pages/Orders.tsx:37) - a fresh implementation here, not an
 * import (common.md rule: never import from a sibling app). */
function startOfTodayColombo(now = new Date()): Date {
  const colombo = new Date(now.getTime() + 330 * 60_000);
  colombo.setUTCHours(0, 0, 0, 0);
  return new Date(colombo.getTime() - 330 * 60_000);
}

/** `YYYY-MM-DD` in Asia/Colombo - the calendar-date format
 * `GET /admin/dental/appointments`'s `from`/`to` require (see
 * `resources.ts`'s `dental.appointments.list` doc comment). */
function colomboDateString(date: Date): string {
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function addDays(dateString: string, days: number): string {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "1 order needs" vs "3 orders need" - never a bare, ungrammatical count. */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

interface Summary {
  activeDelivery: DeliverySummary | null;
  /** The operator's own deliveries (staff riders): a trip is shown from these. */
  myDeliveries: DeliverySummary[];
  needingPacking: HomeOrder[];
  readyForRider: HomeOrder[];
  onTheRoad: HomeOrder[];
  completedToday: HomeOrder[];
  appointmentsToday: AdminAppointment[];
  appointmentsUpcoming: AdminAppointment[];
  activeRiders: HomeRider[];
}

export function Home() {
  const { user, riderCapability } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Shared with the tab bar's badge (one fetch per app load, see LowStock.tsx).
  const lowStock = useLowStock();
  // Orders a trip's stops when the operator is on one (never sent anywhere).
  const position = useCurrentPosition((summary?.myDeliveries ?? []).filter(isTripStop).length >= 2);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true);
      try {
        const today = colomboDateString(new Date());
        // Upcoming = a 7-calendar-day window starting today (today + the
        // next 6 days) - the brief leaves the exact window to this task's
        // judgement; documented here and in task-F2-report.md.
        const upcomingEnd = addDays(today, 6);

        const [
          needingPacking,
          readyForRider,
          onTheRoad,
          completedToday,
          appointmentsToday,
          appointmentsUpcoming,
          activeRiders,
          myDeliveries,
        ] = await Promise.all([
          ordersApi.needingPacking(),
          ordersApi.readyForRider(),
          ordersApi.onTheRoad(),
          ordersApi.completedToday(startOfTodayColombo()),
          // F9 widened `dental.appointments` into a `list`/`cancel`
          // sub-object (resources.ts's own doc comment) - `.list()` now
          // returns the full `{appointments, pagination}` envelope, so this
          // still-array-only need unwraps it the same way `inventory.stock
          // .list`'s callers already do elsewhere in this app.
          dentalApi.appointments.list({ from: today, to: today, limit: 100 }).then((r) => r.appointments),
          dentalApi.appointments.list({ from: today, to: upcomingEnd, limit: 100 }).then((r) => r.appointments),
          ridersApi.listActive(),
          // ADMIN_ONLY sessions have no rider profile to ask about - this
          // isn't a failure, so it isn't even fetched (brief: "omit ...
          // rather than showing an empty/error state for it").
          riderCapability === 'ADMIN_PLUS_RIDER' ? deliveryApi.list() : Promise.resolve<DeliverySummary[]>([]),
        ]);
        if (riderCapability === 'ADMIN_PLUS_RIDER') {
          // Home sees the whole list, so it may resume (or end) location
          // sharing too - e.g. a restart that lands here mid-delivery.
          syncTrackingFromList(myDeliveries).catch(() => undefined);
        }

        setSummary({
          // The one to act on now (at the door, on the road, ready to pick
          // up), else the first still-open one (e.g. being packed).
          activeDelivery:
            splitQueue(myDeliveries).now ??
            myDeliveries.find((d) => !CLOSED_ASSIGNMENT_STATUSES.has(d.assignment_status)) ??
            null,
          myDeliveries,
          needingPacking,
          readyForRider,
          onTheRoad,
          completedToday,
          appointmentsToday,
          appointmentsUpcoming,
          activeRiders,
        });
        setError(null);
      } catch (err) {
        setError(errorMessage(err, 'Could not load the summary.'));
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [riderCapability]
  );

  useEffect(() => {
    // `riderCapability` is already known by the time Home mounts -
    // AuthContext resolves it sequentially before `status` flips to
    // 'authenticated' (task-F1-report.md §4) - so this only runs once.
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    void load(true);
    void lowStock.refresh();
  };

  if (error && !summary) {
    return (
      <div className="page">
        <PageHeader title="Home" description="Blynk Operations" />
        <p className="field__error">{error}</p>
        <button type="button" className="button" onClick={refresh}>
          Try again
        </button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="page">
        <PageHeader title="Home" description="Blynk Operations" />
        <p className="loading" role="status">
          Loading summary…
        </p>
      </div>
    );
  }

  const trip = tripOf(summary.myDeliveries, position);
  const attention: { text: string; to: string; label: string }[] = [];
  if (summary.needingPacking.length > 0) {
    attention.push({
      text: `${plural(summary.needingPacking.length, 'order needs', 'orders need')} packing.`,
      // `?focus=packing` (task F3's Orders board) scrolls straight to the
      // "To pack" lane instead of landing on an unfiltered board - the
      // deep-link nice-to-have review-F2-report.md flagged as F3's job.
      to: '/orders?focus=packing',
      label: 'Go to Orders',
    });
  }
  if (summary.readyForRider.length > 0) {
    attention.push({
      text: `${plural(summary.readyForRider.length, 'order is', 'orders are')} packed, waiting for a rider.`,
      to: '/orders?focus=readyForRider',
      label: 'Assign a rider',
    });
  }

  const lowCounts = lowStock.data?.counts;
  if (lowCounts && lowCounts.total > 0) {
    const parts = [
      lowCounts.out > 0 ? `${plural(lowCounts.out, 'product is', 'products are')} out of stock` : null,
      lowCounts.low > 0 ? `${plural(lowCounts.low, 'product is', 'products are')} running low` : null,
    ].filter(Boolean);
    attention.push({
      text: `${parts.join(', ')}.`,
      to: '/catalog/inventory/low-stock',
      label: 'Restock',
    });
  }

  return (
    <div className="page">
      <PageHeader
        title={`Welcome, ${user?.full_name ?? user?.phone ?? 'operator'}`}
        description="Blynk Operations"
        actions={
          <button type="button" className="button button--ghost" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error ? <p className="field__error">{error} Showing the last successful load.</p> : null}

      {riderCapability === 'ADMIN_PLUS_RIDER' ? (
        <section className="section">
          <h2 className="section-label">Active delivery</h2>
          {trip ? (
            <TripCard stops={trip} />
          ) : summary.activeDelivery ? (
            <div className="delivery-card delivery-card--active">
              <span className="delivery-card__status">{statusLabel(summary.activeDelivery)}</span>
              <p className="delivery-card__dest">{summary.activeDelivery.delivery_address_line1}</p>
              <p className="delivery-card__meta">
                <span>#{summary.activeDelivery.order_number}</span>
                <span>{summary.activeDelivery.delivery_recipient_name}</span>
                <span>{summary.activeDelivery.delivery_city}</span>
              </p>
              {owesCash(summary.activeDelivery) ? (
                <p className="delivery-card__meta">
                  <span className="order-detail__strong">
                    Cash to collect: {formatMoney(summary.activeDelivery.total_amount)}
                  </span>
                </p>
              ) : null}
              {/* F4 registers this exact route (`/delivery/:id`) - see
                  task-F2-report.md for the coordination note. */}
              <Link className="primary" to={`/delivery/${summary.activeDelivery.delivery_id}`}>
                Open delivery
              </Link>
            </div>
          ) : (
            <p className="attention__clear">No active delivery right now.</p>
          )}
        </section>
      ) : null}

      <section className="figures">
        <Figure value={summary.onTheRoad.length} label="On the road" to="/orders" />
        <Figure value={summary.completedToday.length} label="Completed today" to="/orders" />
        <Figure value={summary.appointmentsToday.length} label="Appointments today" to="/catalog" />
        <Figure value={summary.appointmentsUpcoming.length} label="Upcoming (7 days)" to="/catalog" />
        <Figure value={summary.activeRiders.length} label="Active riders" to="/more" />
      </section>

      <section className="attention">
        <h2 className="section-label">Needs a look</h2>
        {attention.length === 0 ? (
          <p className="attention__clear">Nothing needs attention right now.</p>
        ) : (
          <ul className="attention__list">
            {attention.map((item) => (
              <li key={item.text} className="attention__item">
                <span>{item.text}</span>
                <Link className="link" to={item.to}>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({ value, label, to }: { value: number; label: string; to: string }) {
  return (
    // aria-label makes the accessible name deterministic ("4 On the road")
    // rather than relying on the browser's whitespace-collapsing behaviour
    // between the two child spans.
    <Link to={to} className="figure" aria-label={`${value} ${label}`}>
      <span className="figure__value">{value}</span>
      <span className="figure__label">{label}</span>
    </Link>
  );
}
