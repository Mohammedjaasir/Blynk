import { useCallback, useEffect, useRef, useState } from 'react';
import { sellerApi } from '../api/resources';
import type { InsightDays, InsightProduct, Insights } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { formatDate, formatNumber, lkr } from '../lib/format';
import { isFeatureOff, stockLine, trendOf, type Trend } from '../lib/requests';
import { IconMinus, IconSpark, IconTrendDown, IconTrendUp, IconTruck } from './icons';
import { Illustration } from './Illustration';
import { ErrorState } from './ui';

const PERIODS: { days: InsightDays; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
];

function before(days: InsightDays): string {
  return days === 7 ? 'last week' : 'the 30 days before';
}

/** "18 Oct - 24 Oct" (the year only when it differs). */
function periodLabel(from: string, to: string): string {
  const a = formatDate(from);
  const b = formatDate(to);
  if (!a || !b) return '';
  const sameYear = a.slice(-4) === b.slice(-4);
  return `${sameYear ? a.slice(0, -5) : a} – ${b.slice(0, -5)}`;
}

function TrendMark({ trend, days, size = 16 }: { trend: Trend; days: InsightDays; size?: number }) {
  const words =
    trend.kind === 'new'
      ? `New - no sales ${before(days)}`
      : trend.kind === 'flat'
        ? `Same as ${before(days)}`
        : `${trend.kind === 'up' ? 'Up' : 'Down'} ${trend.label.replace(/^[+-]/, '')} on ${before(days)}`;
  return (
    <span className={`trend trend--${trend.kind}`} title={words}>
      <span className="trend__icon" aria-hidden="true">
        {trend.kind === 'up' ? (
          <IconTrendUp size={size} />
        ) : trend.kind === 'down' ? (
          <IconTrendDown size={size} />
        ) : trend.kind === 'flat' ? (
          <IconMinus size={size} />
        ) : (
          <IconSpark size={size} />
        )}
      </span>
      <span aria-hidden="true">{trend.label}</span>
      <span className="sr-only">{words}</span>
    </span>
  );
}

/**
 * "Best sellers this week" on the home screen: the top products by units sold,
 * with a trend arrow against the period before, a bar, stock left at Blynk and
 * a "Restock soon" badge. 7 / 30 days. Hidden while the server has no insights
 * yet (503 SELLER_REQUESTS_NOT_READY or 404).
 */
export function BestSellers({ onBringMore }: { onBringMore?: (productId: string) => void }) {
  const [days, setDays] = useState<InsightDays>(7);
  const [data, setData] = useState<Insights | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'off' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);

  const load = useCallback(async (d: InsightDays) => {
    const ticket = ++asked.current;
    setState('loading');
    try {
      const result = await sellerApi.insights(d);
      if (ticket !== asked.current) return;
      setData(result);
      setState('ready');
    } catch (err) {
      if (ticket !== asked.current) return;
      if (isFeatureOff(err)) {
        setState('off');
        return;
      }
      setError(errorMessage(err, 'Could not load your best sellers. Please try again.'));
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  useEffect(
    () => () => {
      asked.current += 1;
    },
    []
  );

  if (state === 'off') return null;

  const top = (data?.top ?? []).slice(0, 6);
  const max = Math.max(1, ...top.map((t) => Math.max(Number(t.units) || 0, Number(t.units_prev_period) || 0)));
  const totals = data?.totals;
  const overall = totals ? trendOf(totals.units, totals.units_prev) : null;
  const restock = top.filter((t) => t.restock_suggested).length;
  const firstLoad = state === 'loading' && !data;

  return (
    <section className="bezel best rise" style={{ ['--i' as string]: 2 }} aria-labelledby="best-title">
      <div className="bezel__core best__core">
        <header className="best__head">
          <div className="best__titles">
            <p className="eyebrow">
              <IconSpark size={13} /> Your best sellers
            </p>
            <h2 id="best-title" className="best__title">
              {days === 7 ? 'Best sellers this week' : 'Best sellers, last 30 days'}
            </h2>
            {data ? <p className="best__period">{periodLabel(data.period.from, data.period.to)}</p> : null}
          </div>
          <div className="toggle" role="group" aria-label="Period" style={{ ['--index' as string]: days === 7 ? 0 : 1 }}>
            <span className="toggle__thumb" aria-hidden="true" />
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                className="toggle__option"
                aria-pressed={days === p.days}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </header>

        {state === 'error' ? (
          <ErrorState message={error ?? 'Could not load your best sellers.'} onRetry={() => void load(days)} />
        ) : firstLoad ? (
          <div className="best__skeleton" role="status" aria-label="Loading your best sellers">
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel" style={{ ['--i' as string]: i }} />
            ))}
          </div>
        ) : top.length === 0 || !totals || totals.units <= 0 ? (
          <div className="best__empty">
            <Illustration name="receipt" className="best__empty-art" />
            <div>
              <p className="best__empty-title">{days === 7 ? 'No sales yet this week' : 'No sales in the last 30 days'}</p>
              <p className="muted">When customers buy your products, your best sellers show up here.</p>
            </div>
          </div>
        ) : (
          <div className={`best__grid${state === 'loading' ? ' is-busy' : ''}`} aria-busy={state === 'loading'} key={days}>
            <div className="best__summary">
              <p className="best__label">Units sold</p>
              <p className="best__big" data-testid="best-units">
                {formatNumber(totals.units)}
              </p>
              {overall ? (
                <p className="best__vs">
                  <TrendMark trend={overall} days={days} size={15} />
                  <span>vs {before(days)}</span>
                </p>
              ) : null}
              <dl className="best__facts">
                <div>
                  <dt>Sales</dt>
                  <dd>{lkr(totals.gross)}</dd>
                </div>
                <div>
                  <dt>Restock soon</dt>
                  <dd>{restock === 0 ? 'None' : `${restock} product${restock === 1 ? '' : 's'}`}</dd>
                </div>
              </dl>
            </div>

            <ol className="best__list" aria-label={days === 7 ? 'Best sellers this week' : 'Best sellers, last 30 days'}>
              {top.map((item, index) => (
                <BestRow
                  key={item.product_id}
                  item={item}
                  index={index}
                  max={max}
                  days={days}
                  onBringMore={onBringMore}
                />
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}

function BestRow({
  item,
  index,
  max,
  days,
  onBringMore,
}: {
  item: InsightProduct;
  index: number;
  max: number;
  days: InsightDays;
  onBringMore?: (productId: string) => void;
}) {
  const trend = trendOf(item.units, item.units_prev_period);
  const share = Math.max(3, Math.round(((Number(item.units) || 0) / max) * 100));
  const prev = Math.round(((Number(item.units_prev_period) || 0) / max) * 100);
  return (
    <li
      className={`brow${index === 0 ? ' brow--first' : ''}${item.restock_suggested ? ' brow--restock' : ''}`}
      style={{ ['--i' as string]: index }}
      aria-label={item.name}
    >
      <span className="brow__rank" aria-hidden="true">
        {index + 1}
      </span>
      {item.image_url ? (
        <img className="brow__thumb" src={item.image_url} alt="" loading="lazy" />
      ) : (
        <span className="brow__thumb brow__thumb--none" aria-hidden="true">
          <Illustration name="jar" />
        </span>
      )}
      <div className="brow__main">
        <div className="brow__top">
          <span className="brow__name">{item.name}</span>
          <span className="brow__units">
            <strong>{formatNumber(item.units)}</strong> sold
          </span>
        </div>
        <div className="brow__bar" aria-hidden="true">
          <span className="brow__fill" style={{ ['--w' as string]: `${share}%` }} />
          {item.units_prev_period > 0 ? <span className="brow__prev" style={{ left: `${Math.min(prev, 100)}%` }} /> : null}
        </div>
        <div className="brow__foot">
          <TrendMark trend={trend} days={days} />
          <span className="brow__stock">{stockLine(item)}</span>
          {item.restock_suggested ? (
            <span className="chip chip--wait chip--small brow__badge">
              <span className="chip__dot" aria-hidden="true" />
              Restock soon
            </span>
          ) : null}
          {item.restock_suggested && onBringMore ? (
            <button
              type="button"
              className="brow__more"
              onClick={() => onBringMore(item.product_id)}
              aria-label={`Bring more ${item.name}`}
            >
              <IconTruck size={15} /> Bring more
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
