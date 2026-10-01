import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { dayApi } from '../api/resources';
import type { DayTotals, RiderDayDelivery } from '../api/types';
import { Banner } from '../components/Banner';
import { Header } from '../components/Header';
import { errorMessage } from '../lib/errors';
import { formatMoney, formatTime, shortOrderNumber } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { useRevalidate } from '../lib/useRevalidate';

const OUTCOME: Record<RiderDayDelivery['outcome'], { label: string; tone: string }> = {
  DELIVERED: { label: 'Delivered', tone: 'done' },
  FAILED: { label: "Couldn't deliver", tone: 'stop' },
  CUSTOMER_UNAVAILABLE: { label: "Couldn't reach customer", tone: 'stop' },
};

/**
 * "My day" (2026-09-30): the rider's own work in counts - delivered, not
 * delivered, and the cash collected at the door - today and this week
 * (Monday to Sunday, Sri Lanka time), then today's deliveries one line each.
 * Counts only: no pay amounts. Everything comes from GET /riders/me/day,
 * which only ever answers for the signed-in rider.
 */
export function MyDay() {
  const { data, error, loading, loadedAt, reload } = useLoad(() => dayApi.get(), []);
  const refresh = useCallback(() => void reload(), [reload]);
  useRevalidate(refresh);

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
      <Header onRefresh={refresh} refreshing={loading} refreshLabel="Refresh my day" leading={back} />
      <main className="page">
        <h1 className="day__title">My day</h1>
        {error ? <Banner message={errorMessage(error)} stamp={data ? loadedAt : null} onRetry={refresh} /> : null}
        {!data && !error ? (
          <p className="page__loading" role="status">
            Loading your day…
          </p>
        ) : null}

        {data ? (
          <>
            <Totals heading="Today" totals={data.today} />
            <Totals heading="This week" note="Monday to Sunday" totals={data.week} />

            <section className="list" aria-labelledby="today-list-heading">
              <h2 id="today-list-heading" className="eyebrow">
                Today's deliveries
              </h2>
              {data.deliveries_today.length === 0 ? (
                <p className="page__note">Nothing finished yet today.</p>
              ) : (
                <ul className="list__rows">
                  {data.deliveries_today.map((d) => (
                    <li key={d.delivery_id} className="row row--static">
                      <span className="row__number">#{shortOrderNumber(d.order_number)}</span>
                      <span className="row__where">
                        <span className="row__place">{formatTime(d.at)}</span>
                        <span className={`row__status tone--${OUTCOME[d.outcome].tone}`}>{OUTCOME[d.outcome].label}</span>
                      </span>
                      <span className="row__amount">{d.outcome === 'DELIVERED' ? formatMoney(d.cash_collected) : '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </main>
    </>
  );
}

function Totals({ heading, note, totals }: { heading: string; note?: string; totals: DayTotals }) {
  const id = `day-${heading.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className="day" aria-labelledby={id}>
      <h2 id={id} className="eyebrow eyebrow--strong">
        {heading}
        {note ? <span className="day__note"> · {note}</span> : null}
      </h2>
      <dl className="day__grid">
        <div className="day__cell">
          <dt>Delivered</dt>
          <dd>{totals.completed}</dd>
        </div>
        <div className="day__cell">
          <dt>Couldn't deliver</dt>
          <dd>{totals.failed}</dd>
        </div>
        <div className="day__cell">
          <dt>Couldn't reach</dt>
          <dd>{totals.customer_unavailable}</dd>
        </div>
        <div className="day__cell">
          <dt>Cash collected</dt>
          <dd className="day__cash">{formatMoney(totals.cash_collected)}</dd>
        </div>
      </dl>
    </section>
  );
}
