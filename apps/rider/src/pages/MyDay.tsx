import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { dayApi, earningsApi } from '../api/resources';
import type {
  AdjustmentReason,
  BonusKind,
  BoostMode,
  DayTotals,
  EarningsTotals,
  PayParams,
  RiderBoosts,
  RiderDayDelivery,
  RiderEarnings,
} from '../api/types';
import { Banner } from '../components/Banner';
import { Header } from '../components/Header';
import { errorMessage } from '../lib/errors';
import { formatMoney, formatTime, formatUntil, shortOrderNumber } from '../lib/format';
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
 *
 * Staff-controlled pay (owner, 2026-10-10): the card breaks today's total into
 * base pay, bonuses (peak / rain / long distance / daily target) and staff
 * adjustments with their reason, names the pay model, and today's cash line
 * adds "Blynk owes you" when the day's cash could not cover the rider's pay.
 * A COMPANY rider still sees no earnings, but does see any bonuses or
 * adjustments. A rain / peak boost that is on now shows above the card.
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
  const earnings = earningsLoad.data ?? null;
  const commission = earnings?.pay_type === 'COMMISSION' ? earnings : null;
  // A COMPANY rider sees bonuses and adjustments only when there are some,
  // and today's hand-in only when today's extras change it (owner, 2026-10-10).
  const companyExtras = earnings && !commission && hasExtras(earnings) ? earnings : null;
  const companyHandIn = companyExtras && hasExtrasToday(companyExtras.today) ? companyExtras : null;

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
            {earnings?.boosts ? <Boosts boosts={earnings.boosts} /> : null}
            {commission ? <EarningsCard earnings={commission} /> : null}
            {companyExtras ? <ExtrasCard earnings={companyExtras} /> : null}
            <Totals heading="Today" totals={data.today} handIn={commission ?? companyHandIn} />
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
      {hasLinesToday(earnings.today) ? <Breakdown today={earnings.today} withBase /> : null}
      <p className="earn__week">
        <span className="earn__label">This week</span>
        <span className="earn__line">
          <strong className="earn__week-amount">{formatMoney(earnings.week.earnings)}</strong>
          <span className="earn__count"> · {plural(earnings.week.deliveries)}</span>
        </span>
        <WeekExtras week={earnings.week} />
      </p>
      {/* The pay model when the API sends it (owner, 2026-10-10), else the older percent wording. */}
      {earnings.pay_model ? (
        <p className="earn__share">{payModelText(earnings.pay_model)}</p>
      ) : earnings.commission_percent !== null ? (
        <p className="earn__share">You earn {percent.format(earnings.commission_percent)}% of each delivery charge</p>
      ) : null}
    </section>
  );
}

/* ---- Staff-controlled pay (owner, 2026-10-10) ---- */

const BONUS_LABEL: Record<BonusKind, string> = {
  PEAK_BOOST: 'Peak boost',
  RAIN_BOOST: 'Rain boost',
  LONG_DISTANCE: 'Long distance',
  DAILY_TARGET: 'Daily target',
};

const REASON_LABEL: Record<AdjustmentReason, string> = {
  CASH_SHORT: 'Cash short',
  DAMAGED_ITEM: 'Damaged item',
  LATE: 'Late',
  BONUS: 'Bonus',
  OTHER: 'Other',
};

type TodayEarnings = RiderEarnings['today'];

const nonZero = (n: number | undefined | null) => typeof n === 'number' && Math.abs(n) >= 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A line amount with its sign: "+LKR 60" / "−LKR 50" (owner, 2026-10-10). */
const signedMoney = (n: number) => `${n < 0 ? '−' : '+'}${formatMoney(Math.abs(n))}`;
/** A total that may be negative: "LKR 60" / "−LKR 50" (owner, 2026-10-10). */
const totalMoney = (n: number) => (n < 0 ? `−${formatMoney(Math.abs(n))}` : formatMoney(n));

/** "+LKR 30 per delivery" / "+10% per delivery" (owner, 2026-10-10). */
const boostText = (mode: BoostMode, amount: number) =>
  `+${mode === 'PERCENT' ? `${percent.format(amount)}%` : formatMoney(amount)} per delivery`;

/**
 * "You earn 80% of each delivery charge" / "You earn LKR 80 per delivery" /
 * "You earn LKR 50 + LKR 20/km per delivery", plus " · min LKR 60" when the
 * pay has a floor (owner, 2026-10-10).
 */
function payModelText(p: PayParams): string {
  const rate =
    p.model === 'PERCENT'
      ? `${percent.format(p.percent)}% of each delivery charge`
      : p.model === 'FIXED'
        ? `${formatMoney(p.fixed_lkr)} per delivery`
        : `${formatMoney(p.base_lkr)} + ${formatMoney(p.per_km_lkr)}/km per delivery`;
  const floor = p.min_lkr !== null && p.min_lkr !== undefined ? ` · min ${formatMoney(p.min_lkr)}` : '';
  return `You earn ${rate}${floor}`;
}

const hasLinesToday = (t: TodayEarnings) =>
  (t.bonus_lines?.length ?? 0) > 0 || (t.adjustment_lines?.length ?? 0) > 0;

/** Today's bonuses, adjustments or money owed - these concern a COMPANY rider too (owner, 2026-10-10). */
const hasExtrasToday = (t: TodayEarnings) =>
  hasLinesToday(t) || nonZero(t.bonuses) || nonZero(t.adjustments) || (t.payable_to_rider ?? 0) > 0;

const hasExtras = (e: RiderEarnings) =>
  hasExtrasToday(e.today) || nonZero(e.week.bonuses) || nonZero(e.week.adjustments);

const sumLines = (lines: { amount_lkr: number }[] | undefined) =>
  (lines ?? []).reduce((total, line) => total + line.amount_lkr, 0);

/** Bonuses + adjustments, from the totals or, failing that, today's lines (owner, 2026-10-10). */
function extrasTotal(t: EarningsTotals, today?: TodayEarnings): number {
  const bonuses = t.bonuses ?? (today ? sumLines(today.bonus_lines) : 0);
  const adjustments = t.adjustments ?? (today ? sumLines(today.adjustment_lines) : 0);
  return round2(bonuses + adjustments);
}

/**
 * Today's pay line by line (owner, 2026-10-10): base pay for the deliveries
 * (COMMISSION riders), each bonus kind with its count, each staff adjustment
 * with its reason and note, then the total.
 */
function Breakdown({ today, withBase }: { today: TodayEarnings; withBase: boolean }) {
  const bonuses = today.bonus_lines ?? [];
  const adjustments = today.adjustment_lines ?? [];
  const extras = extrasTotal(today, today);
  // An API that sends the lines also sends base_earnings; derive it otherwise.
  const base = today.base_earnings ?? round2(today.earnings - extras);
  const total = withBase ? today.earnings : extras;
  return (
    <dl className="earn__breakdown" aria-label="Today line by line">
      {withBase ? (
        <div className="earn__row">
          <dt>Deliveries</dt>
          <dd>{formatMoney(base)}</dd>
        </div>
      ) : null}
      {bonuses.map((line) => (
        <div key={line.kind} className="earn__row earn__row--plus">
          <dt>
            {BONUS_LABEL[line.kind] ?? line.kind}
            {line.count > 0 ? <span className="earn__times"> ×{line.count}</span> : null}
          </dt>
          <dd>{signedMoney(line.amount_lkr)}</dd>
        </div>
      ))}
      {adjustments.map((line) => (
        <div key={line.id} className={`earn__row ${line.amount_lkr < 0 ? 'earn__row--minus' : 'earn__row--plus'}`}>
          <dt>
            {REASON_LABEL[line.reason] ?? line.reason}
            {line.note ? <span className="earn__note"> · {line.note}</span> : null}
          </dt>
          <dd>{signedMoney(line.amount_lkr)}</dd>
        </div>
      ))}
      <div className="earn__row earn__row--total">
        <dt>Total</dt>
        <dd>{totalMoney(total)}</dd>
      </div>
    </dl>
  );
}

/** "incl. +LKR 240 bonuses · −LKR 50 adjustments" under the week, when non-zero (owner, 2026-10-10). */
function WeekExtras({ week }: { week: EarningsTotals }) {
  const parts: string[] = [];
  if (week.bonuses !== undefined && nonZero(week.bonuses)) parts.push(`${signedMoney(week.bonuses)} bonuses`);
  if (week.adjustments !== undefined && nonZero(week.adjustments))
    parts.push(`${signedMoney(week.adjustments)} adjustments`);
  if (parts.length === 0) return null;
  return <span className="earn__extras">incl. {parts.join(' · ')}</span>;
}

/**
 * COMPANY riders (owner, 2026-10-10): no earnings, but bonuses (when staff
 * switch them on for company riders) and adjustments (everyone) still show.
 */
function ExtrasCard({ earnings }: { earnings: RiderEarnings }) {
  const today = extrasTotal(earnings.today, earnings.today);
  const week = extrasTotal(earnings.week);
  return (
    <section className="earn" aria-labelledby="extras-heading">
      <h2 id="extras-heading" className="earn__eyebrow">
        Bonuses and adjustments
      </h2>
      <p className="earn__today">
        <span className="earn__label">Today</span>
        <span className="earn__line">
          <strong className="earn__amount">{totalMoney(today)}</strong>
        </span>
      </p>
      {hasLinesToday(earnings.today) ? <Breakdown today={earnings.today} withBase={false} /> : null}
      {nonZero(week) ? (
        <p className="earn__week">
          <span className="earn__label">This week</span>
          <span className="earn__line">
            <strong className="earn__week-amount">{totalMoney(week)}</strong>
          </span>
        </p>
      ) : null}
    </section>
  );
}

/**
 * Boosts on now (owner, 2026-10-10): a rain boost banner ("Rain boost +LKR 30
 * per delivery until 6:30 PM") and a smaller "Peak boost now" chip, only when
 * automatic bonuses apply to this rider.
 */
function Boosts({ boosts }: { boosts: RiderBoosts }) {
  if (!boosts.applies) return null;
  const rain = boosts.rain?.active ? boosts.rain : null;
  const peak = boosts.peak?.active_now ? boosts.peak : null;
  if (!rain && !peak) return null;
  const until = rain?.until ? formatUntil(rain.until) : null;
  return (
    <section className="boosts" aria-label="Boosts on now">
      {rain ? (
        <p className="boost">
          <svg className="boost__icon" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
            <path
              d="M7 15a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7H7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="boost__text">
            <strong className="boost__title">Rain boost</strong>{' '}
            <span className="boost__amount">{boostText(rain.mode, rain.amount)}</span>
            {until ? <span className="boost__until"> until {until}</span> : null}
          </span>
        </p>
      ) : null}
      {peak ? (
        <p className="boost-chip">
          Peak boost now <span className="boost-chip__amount">{boostText(peak.mode, peak.amount)}</span>
        </p>
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
  /** COMMISSION riders: today's cash split (owner, 2026-10-09); COMPANY riders with extras today (owner, 2026-10-10). */
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
      {/* A COMPANY rider sees this only when today's bonuses or adjustments
          change it, and "keep" only when there is something to keep. "Blynk
          owes you" when the day's cash could not cover it (owner, 2026-10-10). */}
      {handIn ? (
        <p className="handin">
          <span className="handin__give">
            Hand in <strong>{formatMoney(handIn.today.cash_to_hand_in)}</strong>
          </span>
          {handIn.pay_type === 'COMMISSION' || nonZero(handIn.today.cash_to_keep) ? (
            <span className="handin__keep">
              , keep <strong>{formatMoney(handIn.today.cash_to_keep)}</strong>
            </span>
          ) : null}
          {(handIn.today.payable_to_rider ?? 0) > 0 ? (
            <span className="handin__owed">
              Blynk owes you <strong>{formatMoney(handIn.today.payable_to_rider ?? 0)}</strong>
            </span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
