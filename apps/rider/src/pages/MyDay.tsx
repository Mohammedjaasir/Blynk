import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { dayApi, earningsApi } from '../api/resources';
import type { DayTotals, RiderDayDelivery, RiderEarnings } from '../api/types';
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
 * Counts and cash come from GET /riders/me/day, which only ever answers for
 * the signed-in rider.
 *
 * Pay (owner, 2026-10-09): GET /riders/me/earnings says whether the rider is a
 * COMPANY rider (salaried - no earnings shown, hands in all the cash) or a
 * COMMISSION rider (earns a share of each delivery charge and keeps it out of
 * the cash collected). Only a COMMISSION rider sees money earned and the
 * "Hand in X, keep Y" split. That request is separate on purpose: if it fails,
 * My day still shows and the earnings card simply stays hidden.
 */
export function MyDay() {
  const { data, error, loading, loadedAt, reload } = useLoad(() => dayApi.get(), []);
  // Never surfaced as an error: a failed earnings load only hides the card.
  const earningsLoad = useLoad(() => earningsApi.get(), []);
  const reloadEarnings = earningsLoad.reload;
  const refresh = useCallback(() => {
    void reload();
    void reloadEarnings();
  }, [reload, reloadEarnings]);
  useRevalidate(refresh);
  // Keep the last good earnings through a failed refresh (as useLoad does for
  // the day); hide the card only when there is nothing to show.
  const commission = earningsLoad.data?.pay_type === 'COMMISSION' ? earningsLoad.data : null;

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
            {commission ? <EarningsCard earnings={commission} /> : null}
            <Totals heading="Today" totals={data.today} handIn={commission} />
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

const plural = (n: number) => `${n} ${n === 1 ? 'delivery' : 'deliveries'}`;
const percent = new Intl.NumberFormat('en-LK', { maximumFractionDigits: 2 });

/**
 * COMMISSION riders only (owner, 2026-10-09): money earned today and this week
 * from their share of each delivered order's standard delivery charge - the
 * share is earned even when the customer's delivery was free.
 */
function EarningsCard({ earnings }: { earnings: RiderEarnings }) {
  return (
    <section className="earn" aria-labelledby="earn-heading">
      <h2 id="earn-heading" className="earn__eyebrow">
        Your earnings
      </h2>
      <p className="earn__today">
        <span className="earn__label">Today</span>
        <span className="earn__line">
          <strong className="earn__amount">{formatMoney(earnings.today.earnings)}</strong> earned
          <span className="earn__count"> · {plural(earnings.today.deliveries)}</span>
        </span>
      </p>
      <p className="earn__week">
        <span className="earn__label">This week</span>
        <span className="earn__line">
          <strong className="earn__week-amount">{formatMoney(earnings.week.earnings)}</strong>
          <span className="earn__count"> · {plural(earnings.week.deliveries)}</span>
        </span>
      </p>
      {earnings.commission_percent !== null ? (
        <p className="earn__share">You earn {percent.format(earnings.commission_percent)}% of each delivery charge</p>
      ) : null}
    </section>
  );
}

function Totals({
  heading,
  note,
  totals,
  handIn,
}: {
  heading: string;
  note?: string;
  totals: DayTotals;
  /** COMMISSION riders: today's cash split (owner, 2026-10-09). */
  handIn?: RiderEarnings | null;
}) {
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
      {/* A commission rider keeps their earned share out of the cash and hands
          in the rest (owner, 2026-10-09). Company riders hand in everything,
          so the plain "Cash collected" figure stays their wording. */}
      {handIn ? (
        <p className="handin">
          <span className="handin__give">
            Hand in <strong>{formatMoney(handIn.today.cash_to_hand_in)}</strong>
          </span>
          <span className="handin__keep">
            , keep <strong>{formatMoney(handIn.today.cash_to_keep)}</strong>
          </span>
        </p>
      ) : null}
    </section>
  );
}
