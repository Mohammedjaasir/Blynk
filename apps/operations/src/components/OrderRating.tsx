import { useEffect, useState } from 'react';
import { ratings as ratingsApi, type OrderRating as Rating } from '../api/growth';
import { BAD_TAGS, LOW_RATING_STARS, starsText, tagLabel } from '../lib/growth';
import { formatDateTime } from '../lib/inventory';
import { formatMoney } from '../lib/orders';
import './growth.css';

/**
 * The customer's rating and rider tip on the order screen (plan
 * 2026-10-24-groups-ratings-requests.md §B). The rating comes with the order when the API
 * sends `rating` (null = not rated); otherwise a delivered order looks it up in
 * GET /admin/ratings (quietly - before migration 055 there is nothing to show).
 * The tip (`rider_tip`) goes 100% to the rider who delivered the order.
 */
export function OrderRating({
  orderId,
  status,
  rating,
  riderTip,
}: {
  orderId: string;
  status: string;
  /** `order.rating`: undefined when the API does not send it, null when not rated. */
  rating: unknown;
  /** `order.rider_tip` (NUMERIC may arrive as a string). */
  riderTip: number | string | null | undefined;
}) {
  const sent = rating !== undefined;
  const [looked, setLooked] = useState<Rating | null>(null);

  useEffect(() => {
    if (sent || status !== 'DELIVERED') return;
    let live = true;
    ratingsApi
      .forOrder(orderId)
      .then((r) => live && setLooked(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [orderId, status, sent]);

  const shown = sent ? asRating(rating) : looked;
  const tip = typeof riderTip === 'number' ? riderTip : Number(riderTip ?? 0);
  if (!shown && !(tip > 0)) return null;

  return (
    <section className="order-detail__section" aria-label="Rating and tip">
      <h2 className="order-detail__label">Customer rating</h2>
      {shown ? (
        <>
          <p>
            <span
              className={shown.stars <= LOW_RATING_STARS ? 'stars stars--low' : 'stars'}
              aria-label={`${shown.stars} out of 5 stars`}
              data-testid="order-rating-stars"
            >
              {starsText(shown.stars)}
            </span>
            {shown.created_at ? <span className="order-detail__meta"> · {formatDateTime(shown.created_at)}</span> : null}
          </p>
          {shown.tags.length > 0 ? (
            <ul className="rating-tags" aria-label="Rating tags">
              {shown.tags.map((t) => (
                <li key={t} className={`chip${BAD_TAGS.has(t) ? ' rating-tag--bad' : ''}`}>
                  {tagLabel(t)}
                </li>
              ))}
            </ul>
          ) : null}
          {shown.comment ? <p className="order-rating__comment">“{shown.comment}”</p> : null}
        </>
      ) : (
        <p className="order-detail__meta">Not rated yet.</p>
      )}
      {tip > 0 ? (
        <p className="order-detail__meta" data-testid="order-rider-tip">
          Rider tip <strong>{formatMoney(tip)}</strong> - all of it goes to the rider.
        </p>
      ) : null}
    </section>
  );
}

function asRating(v: unknown): Rating | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const stars = Number(r.stars);
  if (!Number.isFinite(stars) || stars < 1) return null;
  return {
    order_id: String(r.order_id ?? ''),
    order_number: null,
    stars: Math.min(5, Math.round(stars)),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    comment: typeof r.comment === 'string' && r.comment ? r.comment : null,
    created_at: typeof r.created_at === 'string' ? r.created_at : null,
    customer_name: null,
    customer_phone: null,
    rider_id: null,
    rider_name: null,
  };
}
