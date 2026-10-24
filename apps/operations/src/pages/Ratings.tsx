import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ratings as ratingsApi, type OrderRating, type RatingsQuery, type RatingsSummary } from '../api/growth';
import { PageHeader } from '../components/Layout';
import { EmptyState, Spinner } from '../components/ui';
import '../components/growth.css';
import { formatDateTime } from '../lib/inventory';
import { BAD_TAGS, LOW_RATING_STARS, averageText, growthErrorMessage, isNotReady, starsText, tagLabel } from '../lib/growth';

/**
 * More -> Ratings (plan 2026-10-24-groups-ratings-requests.md §B): what customers said after
 * delivery. The last 30 days at the top (average, stars, most-picked tags, each rider's
 * average), then every rating, newest first, each linking to its order. A rating of 2 stars
 * or less also reaches staff phones as a push that opens the order.
 */

const SUMMARY_DAYS = 30;

type Filter = 'all' | 'low';

export function Ratings() {
  const [summary, setSummary] = useState<RatingsSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [rows, setRows] = useState<OrderRating[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [rider, setRider] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    ratingsApi
      .summary(SUMMARY_DAYS)
      .then((s) => {
        setSummary(s);
        setSummaryError(null);
      })
      .catch((err) => {
        setNotReady(isNotReady(err));
        setSummaryError(growthErrorMessage(err, 'Could not load the rating summary.'));
      });
  }, []);

  useEffect(() => {
    let live = true;
    setRows(null);
    const query: RatingsQuery = {};
    if (filter === 'low') query.stars_max = LOW_RATING_STARS;
    if (rider) query.rider_id = rider.id;
    ratingsApi
      .list(query)
      .then((list) => {
        if (!live) return;
        // Applied here too, so an API that ignores a filter still shows the right rows.
        setRows(list.filter((r) => (filter === 'low' ? r.stars <= LOW_RATING_STARS : true) && (!rider || r.rider_id === rider.id)));
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        setRows([]);
        setNotReady(isNotReady(err));
        setError(growthErrorMessage(err, 'Could not load the ratings.'));
      });
    return () => {
      live = false;
    };
  }, [filter, rider]);

  return (
    <div className="page">
      <Link to="/more" className="link">
        ← More
      </Link>
      <PageHeader title="Ratings" description="Stars, tags and comments customers leave after delivery." />

      {notReady ? (
        <p className="banner" role="alert">
          {error ?? summaryError}
        </p>
      ) : (
        <>
          {summaryError ? (
            <p className="field__error" role="alert">
              {summaryError}
            </p>
          ) : null}
          {summary ? <Summary summary={summary} onRider={(id, name) => setRider({ id, name })} /> : summaryError ? null : <Spinner label="Loading summary" />}
        </>
      )}

      {!notReady ? (
        <section className="section" aria-labelledby="ratings-list-title">
          <h2 className="section-label" id="ratings-list-title">
            Newest ratings
          </h2>
          <div className="segmented growth-filters" role="group" aria-label="Show ratings">
            {(
              [
                { id: 'all', text: 'All' },
                { id: 'low', text: `Low (${LOW_RATING_STARS} stars or less)` },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                className={filter === f.id ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.text}
              </button>
            ))}
          </div>
          {rider ? (
            <p className="card__row">
              <span className="card__label">Rider: {rider.name}</span>
              <button type="button" className="button button--ghost button--sm" onClick={() => setRider(null)}>
                Show every rider
              </button>
            </p>
          ) : null}
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
          {rows === null ? (
            <Spinner label="Loading ratings" />
          ) : rows.length === 0 ? (
            error ? null : <EmptyState title="No ratings here yet" message="Customers can rate an order for 14 days after it is delivered." />
          ) : (
            <ul className="cat-list" aria-label="Ratings">
              {rows.map((r) => (
                <RatingRow key={`${r.order_id}-${r.created_at}`} rating={r} />
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Summary({ summary, onRider }: { summary: RatingsSummary; onRider(id: string, name: string): void }) {
  const max = Math.max(1, ...summary.per_star.slice(1));
  return (
    <section className="card" aria-labelledby="ratings-summary-title">
      <h2 className="section-label" id="ratings-summary-title">
        Last {summary.days} days
      </h2>
      <div className="rating-summary">
        <span className="rating-summary__avg" data-testid="ratings-average">
          {averageText(summary.average)}
        </span>
        <span className="stars" aria-hidden="true">
          {starsText(summary.average ?? 0)}
        </span>
        <span className="quiet" data-testid="ratings-count">
          {summary.count} {summary.count === 1 ? 'rating' : 'ratings'}
        </span>
      </div>
      <ul className="star-bars" aria-label="Ratings per star">
        {[5, 4, 3, 2, 1].map((s) => (
          <li key={s} className="star-bars__row" aria-label={`${s} stars: ${summary.per_star[s]}`}>
            <span>{s}★</span>
            <span className="star-bars__track">
              <span className="star-bars__fill" style={{ width: `${(summary.per_star[s] / max) * 100}%` }} />
            </span>
            <span className="star-bars__count mono">{summary.per_star[s]}</span>
          </li>
        ))}
      </ul>
      {summary.top_tags.length > 0 ? (
        <>
          <h3 className="field__label">Most picked</h3>
          <ul className="rating-tags" aria-label="Most picked tags">
            {summary.top_tags.slice(0, 6).map((t) => (
              <li key={t.tag} className={`chip${BAD_TAGS.has(t.tag) ? ' rating-tag--bad' : ''}`}>
                {tagLabel(t.tag)} · {t.count}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {summary.per_rider.length > 0 ? (
        <>
          <h3 className="field__label">Riders</h3>
          <ul className="cat-list" aria-label="Rider averages">
            {summary.per_rider.map((p) => {
              const name = p.rider_name ?? 'Rider';
              return (
                <li key={p.rider_id ?? name} className="card__row">
                  <span className="card__label">
                    {name} · {averageText(p.average)}★ ({p.count})
                  </span>
                  {p.rider_id ? (
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Show ratings for ${name}`}
                      onClick={() => onRider(p.rider_id!, name)}
                    >
                      Show
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function RatingRow({ rating: r }: { rating: OrderRating }) {
  const low = r.stars <= LOW_RATING_STARS;
  return (
    <li className="card growth-card" aria-label={`${r.stars} stars${r.order_number ? ` on order #${r.order_number}` : ''}`}>
      <div className="growth-card__head">
        <span className={low ? 'stars stars--low' : 'stars'} aria-label={`${r.stars} out of 5 stars`}>
          {starsText(r.stars)}
        </span>
        {r.order_id ? (
          <Link className="link mono" to={`/orders/${r.order_id}`}>
            #{r.order_number ?? 'Order'}
          </Link>
        ) : null}
      </div>
      {r.tags.length > 0 ? (
        <ul className="rating-tags" aria-label="Tags">
          {r.tags.map((t) => (
            <li key={t} className={`chip${BAD_TAGS.has(t) ? ' rating-tag--bad' : ''}`}>
              {tagLabel(t)}
            </li>
          ))}
        </ul>
      ) : null}
      {r.comment ? <p className="order-rating__comment">“{r.comment}”</p> : null}
      <p className="growth-card__meta">
        {[r.created_at ? formatDateTime(r.created_at) : null, r.customer_name ?? r.customer_phone, r.rider_name ? `Rider ${r.rider_name}` : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </li>
  );
}
