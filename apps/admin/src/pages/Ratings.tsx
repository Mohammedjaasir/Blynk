import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  featureErrorMessage,
  ratings as ratingsApi,
  type AdminRating,
  type RatingsFilter,
  type RatingsSummary,
} from '../api/engagement';
import { riders as ridersApi } from '../api/resources';
import type { RiderOption } from '../api/types';
import { PageHeader } from '../components/Layout';
import { EmptyState, Field, Spinner } from '../components/ui';
import { amount, barPercent, starsText, tagLabel, whenText } from '../lib/engagement';
import { formatMoney, shortNumber } from '../lib/orders';
import './engagement.css';

/**
 * Ratings (owner, 2026-10-24: "Rate the order and tip the rider - one tap after delivery"). Customers
 * rate a delivered order 1-5 stars with tags and a comment; here the summary for the last 7, 30 or
 * 90 days and every rating, newest first. Ratings of 2 stars or less also reach staff as a push.
 */
const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

export function Ratings() {
  const [days, setDays] = useState<Period>(30);
  const [summary, setSummary] = useState<RatingsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RatingsFilter>({});
  const [rows, setRows] = useState<AdminRating[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [riderOptions, setRiderOptions] = useState<RiderOption[]>([]);

  useEffect(() => {
    void ridersApi.listForCash().then(setRiderOptions).catch(() => setRiderOptions([]));
  }, []);

  useEffect(() => {
    let live = true;
    setSummary(null);
    ratingsApi
      .summary(days)
      .then((s) => {
        if (!live) return;
        setSummary(s);
        setSummaryError(null);
      })
      .catch((err) => live && setSummaryError(featureErrorMessage(err, 'Could not load the summary.')));
    return () => {
      live = false;
    };
  }, [days]);

  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    let live = true;
    setRows(null);
    ratingsApi
      .list(JSON.parse(filterKey) as RatingsFilter)
      .then((r) => {
        if (!live) return;
        setRows(r);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        setError(featureErrorMessage(err, 'Could not load the ratings.'));
        setRows([]);
      });
    return () => {
      live = false;
    };
  }, [filterKey]);

  const set = (change: Partial<RatingsFilter>) => setFilter((f) => ({ ...f, ...change }));
  const filtered = !!(filter.stars_max || filter.rider_id || filter.from || filter.to);

  return (
    <>
      <PageHeader
        title="Ratings"
        description="How customers rate their delivered orders, and the rider tips they leave."
        actions={
          <div className="segmented" role="group" aria-label="Summary period">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                className={p === days ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={p === days}
                onClick={() => setDays(p)}
              >
                {p} days
              </button>
            ))}
          </div>
        }
      />

      <section className="panel ratings-summary" aria-label="Summary">
        {summaryError ? (
          <p className="field__error" role="alert">
            {summaryError}
          </p>
        ) : !summary ? (
          <Spinner label="Loading the summary" />
        ) : (
          <SummaryView summary={summary} days={days} />
        )}
      </section>

      <div className="ratings-filters" role="group" aria-label="Filter ratings">
        <Field label="Stars">
          <select
            className="input"
            value={filter.stars_max ?? ''}
            onChange={(e) => set({ stars_max: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Any</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'star' : 'stars'} or less
              </option>
            ))}
          </select>
        </Field>
        <Field label="Rider">
          <select className="input" value={filter.rider_id ?? ''} onChange={(e) => set({ rider_id: e.target.value || undefined })}>
            <option value="">All riders</option>
            {riderOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name ?? r.phone ?? 'Rider'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input className="input" type="date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
        </Field>
        {filtered ? (
          <button type="button" className="button button--ghost button--sm" onClick={() => setFilter({})}>
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      {rows === null ? (
        <Spinner label="Loading the ratings" />
      ) : rows.length === 0 ? (
        error ? null : <EmptyState title={filtered ? 'No ratings match' : 'No ratings yet'} message={filtered ? undefined : 'Customers rate an order after it is delivered.'} />
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Ratings">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Rider</th>
                <th scope="col">Stars</th>
                <th scope="col">Tags</th>
                <th scope="col">Comment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tip = amount(r.rider_tip) + amount(r.rider_tip_wallet);
                const phone = r.customer?.phone ?? r.customer_phone ?? null;
                return (
                <tr key={r.order_id} className={r.stars <= 2 ? 'is-low-rating' : undefined}>
                  <td className="cell__secondary">{whenText(r.created_at)}</td>
                  <td>
                    <Link to={`/orders/${r.order_id}`} aria-label={`Open order #${shortNumber(r.order_number)}`}>
                      #{shortNumber(r.order_number)}
                    </Link>
                    {tip > 0 ? <div className="cell__secondary">Tip {formatMoney(tip)}</div> : null}
                  </td>
                  <td>
                    {r.customer?.name ?? r.customer_name ?? 'Customer'}
                    {phone ? <div className="cell__secondary">{phone}</div> : null}
                  </td>
                  <td>{r.rider?.name ?? r.rider_name ?? '—'}</td>
                  <td>
                    <span className="rating-stars" role="img" aria-label={`${r.stars} of 5 stars`}>
                      {starsText(r.stars)}
                    </span>
                  </td>
                  <td>
                    {(r.tags ?? []).length ? (
                      <span className="tag-chips">
                        {r.tags.map((t) => (
                          <span key={t} className="tag-chip">
                            {tagLabel(t)}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="cell__secondary">—</span>
                    )}
                  </td>
                  <td>{r.comment ? r.comment : <span className="cell__secondary">—</span>}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function SummaryView({ summary, days }: { summary: RatingsSummary; days: number }) {
  const counts = [5, 4, 3, 2, 1].map((s) => summary.per_star[s as 1]);
  if (summary.count === 0) {
    return <p className="form__note">No ratings in the last {days} days.</p>;
  }
  return (
    <div className="ratings-summary__grid">
      <div className="ratings-summary__headline">
        <p className="ratings-summary__average" data-testid="ratings-average">
          {summary.average != null ? summary.average.toFixed(1) : '—'}
          <span aria-hidden="true"> ★</span>
        </p>
        <p className="cell__secondary" data-testid="ratings-count">
          {summary.count} {summary.count === 1 ? 'rating' : 'ratings'} in the last {days} days
        </p>
        {summary.tips && summary.tips.total > 0 ? (
          <p className="cell__secondary" data-testid="ratings-tips">
            Rider tips {formatMoney(summary.tips.total)} on {summary.tips.orders_tipped}{' '}
            {summary.tips.orders_tipped === 1 ? 'order' : 'orders'}
          </p>
        ) : null}
      </div>

      <ul className="star-bars" aria-label="Ratings by stars">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = summary.per_star[star as 1];
          return (
            <li key={star} className="star-bars__row" aria-label={`${star} stars: ${count}`}>
              <span className="star-bars__label">{star} ★</span>
              <span className="star-bars__track">
                <span className="star-bars__fill" style={{ width: `${barPercent(count, counts)}%` }} />
              </span>
              <span className="star-bars__count mono">{count}</span>
            </li>
          );
        })}
      </ul>

      <div>
        <h3 className="order-panel__label">Top tags</h3>
        {summary.top_tags.length === 0 ? (
          <p className="cell__secondary">No tags picked.</p>
        ) : (
          <ul className="plain-list" aria-label="Top tags">
            {summary.top_tags.slice(0, 6).map((t) => (
              <li key={t.tag}>
                <span className="tag-chip">{tagLabel(t.tag)}</span> <span className="mono">{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="order-panel__label">Riders</h3>
        {summary.per_rider.length === 0 ? (
          <p className="cell__secondary">No rider ratings.</p>
        ) : (
          <table className="table table--compact" aria-label="Average by rider">
            <tbody>
              {[...summary.per_rider]
                .sort((a, b) => b.count - a.count)
                .map((r) => (
                  <tr key={r.rider_id ?? r.rider_name ?? 'none'}>
                    <td>{r.rider_name ?? 'No rider'}</td>
                    <td className="num mono">{r.average.toFixed(1)} ★</td>
                    <td className="num cell__secondary">
                      {r.count} {r.count === 1 ? 'rating' : 'ratings'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
