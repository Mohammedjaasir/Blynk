import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { delivery as deliveryApi } from '../../api/resources';
import type { DayTotals, MyEarnings, MyEarningsPeriod, RiderDay, RiderDayDelivery } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { useAuth } from '../../auth/AuthContext';
import { deliveryErrorMessage } from '../../lib/delivery';
import { errorCode } from '../../lib/errors';
import { formatClock, formatMoney, shortNumber } from '../../lib/orders';
import { boostText, colomboClock, describePay, formatPercent, signedMoney } from '../../lib/riderPay';

const OUTCOME: Record<RiderDayDelivery['outcome'], { label: string; tone: string }> = {
  DELIVERED: { label: 'Delivered', tone: 'done' },
  FAILED: { label: "Couldn't deliver", tone: 'stop' },
  CUSTOMER_UNAVAILABLE: { label: "Couldn't reach customer", tone: 'stop' },
};

/**
 * "My day" for an operator who delivers (ported from apps/rider/src/pages/
 * MyDay.tsx): their own work in counts - delivered, not delivered, and the
 * cash collected at the door - today and this week (Monday to Sunday, Sri
 * Lanka time), then today's deliveries one line each. Counts only, no pay.
 * Everything comes from GET /riders/me/day, which only ever answers for the
 * signed-in user's own rider profile.
 *
 * A COMMISSION rider (owner, 2026-10-09) also sees what they earned and how
 * much of the collected cash to keep and hand in, from GET /riders/me/earnings.
 * Company riders are salaried, so nothing extra shows for them.
 *
 * Rider pay controls (owner, 2026-10-10): the pay line names the rider's
 * model, a rain boost shows while it is on, and each period adds its bonuses,
 * deductions / extra pay and what Blynk owes when the cash fell short.
 */
export function MyDay() {
  const { refreshRiderCapability } = useAuth();
  const [day, setDay] = useState<RiderDay | null>(null);
  const [earnings, setEarnings] = useState<MyEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    // Pay is extra: if it cannot load, the day still shows.
    deliveryApi
      .earnings()
      .then(setEarnings)
      .catch(() => setEarnings(null));
    try {
      setDay(await deliveryApi.day());
      setError(null);
    } catch (err) {
      const code = errorCode(err);
      if (code === 'RIDER_PROFILE_NOT_FOUND' || code === 'RIDER_INACTIVE') {
        setNoProfile(true);
        await refreshRiderCapability();
        return;
      }
      setError(deliveryErrorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, [refreshRiderCapability]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <Link to="/delivery" className="link">
        ← Back to Delivery
      </Link>
      <PageHeader
        title="My day"
        description="What you delivered, and the cash you collected."
        actions={
          <button type="button" className="button button--ghost" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {noProfile ? (
        <p className="banner banner--muted" role="status">
          No rider profile is linked to this account yet.
        </p>
      ) : null}
      {error ? (
        <p className="field__error" role="status">
          {error}
        </p>
      ) : null}
      {!day && !error && !noProfile ? (
        <p className="loading" role="status">
          Loading your day…
        </p>
      ) : null}

      {day ? (
        <>
          <Totals heading="Today" totals={day.today} />
          <Totals heading="This week" note="Monday to Sunday" totals={day.week} />
          {earnings?.pay_type === 'COMMISSION' ? <Earnings earnings={earnings} /> : null}

          <section className="section" aria-labelledby="day-list-heading">
            <h2 className="section-label" id="day-list-heading">
              Today's deliveries
            </h2>
            {day.deliveries_today.length === 0 ? (
              <p className="attention__clear">Nothing finished yet today.</p>
            ) : (
              <ul className="attention__list">
                {day.deliveries_today.map((d) => (
                  <li key={d.delivery_id} className="attention__item day-row">
                    <span className="mono">#{shortNumber(d.order_number)}</span>
                    <span>{formatClock(d.at)}</span>
                    <span className={`queue-tone queue-tone--${OUTCOME[d.outcome].tone}`}>{OUTCOME[d.outcome].label}</span>
                    <span className="mono">{d.outcome === 'DELIVERED' ? formatMoney(d.cash_collected) : '—'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Totals({ heading, note, totals }: { heading: string; note?: string; totals: DayTotals }) {
  const id = `day-${heading.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section className="section" aria-labelledby={id}>
      <h2 className="section-label" id={id}>
        {heading}
        {note ? <span className="day__note"> · {note}</span> : null}
      </h2>
      <dl className="figures day-figures">
        <div className="figure">
          <dt className="figure__label">Delivered</dt>
          <dd className="figure__value">{totals.completed}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Couldn't deliver</dt>
          <dd className="figure__value">{totals.failed}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Couldn't reach</dt>
          <dd className="figure__value">{totals.customer_unavailable}</dd>
        </div>
        <div className="figure">
          <dt className="figure__label">Cash collected</dt>
          <dd className="figure__value day__cash">{formatMoney(totals.cash_collected)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Commission pay (owner, 2026-10-09): the rider keeps their share out of the cash. */
function Earnings({ earnings }: { earnings: MyEarnings }) {
  const percent = earnings.commission_percent;
  const rain = earnings.boosts?.applies && earnings.boosts.rain.active ? earnings.boosts.rain : null;
  return (
    <section className="section" aria-labelledby="day-earnings">
      <h2 className="section-label" id="day-earnings">
        Your earnings
        {earnings.pay_model ? (
          <span className="day__note"> · {describePay(earnings.pay_model)}</span>
        ) : percent != null ? (
          <span className="day__note"> · {formatPercent(percent)} of the delivery fee</span>
        ) : null}
      </h2>
      {rain ? (
        <p className="quiet quiet--ok" role="status">
          Rain boost {boostText(rain.mode, rain.amount)} per delivery{rain.until ? ` until ${colomboClock(rain.until)}` : ''}
        </p>
      ) : null}
      <EarningsLine label="Today" period={earnings.today} />
      <EarningsLine label="This week" period={earnings.week} />
    </section>
  );
}

function EarningsLine({ label, period }: { label: string; period: MyEarningsPeriod }) {
  return (
    <div className="card day-earnings" aria-label={`Earnings ${label.toLowerCase()}`}>
      <p className="card__row">
        <span className="card__label">{label}</span>
        <span className="card__value mono">{formatMoney(period.earnings)}</span>
      </p>
      <p className="quiet">
        {period.deliveries} {period.deliveries === 1 ? 'delivery' : 'deliveries'} · Keep {formatMoney(period.cash_to_keep)}, hand in{' '}
        {formatMoney(period.cash_to_hand_in)}
      </p>
      {(period.bonuses ?? 0) > 0 || (period.deductions ?? 0) > 0 || (period.additions ?? 0) > 0 ? (
        <p className="quiet">
          {[
            (period.bonuses ?? 0) > 0 ? `Bonuses ${signedMoney(period.bonuses ?? 0)}` : null,
            (period.deductions ?? 0) > 0 ? `Deductions ${signedMoney(-(period.deductions ?? 0))}` : null,
            (period.additions ?? 0) > 0 ? `Extra pay ${signedMoney(period.additions ?? 0)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {(period.payable_to_rider ?? 0) > 0 ? (
        <p className="quiet">Blynk owes you {formatMoney(period.payable_to_rider ?? 0)}</p>
      ) : null}
    </div>
  );
}
