import type { OrderDetail } from '../api/types';
import { amount, starsText, tagLabel, whenText } from '../lib/engagement';
import { formatMoney } from '../lib/orders';
import '../pages/engagement.css';

/**
 * The customer's rating of the order and the rider tip (migration 055, owner 2026-10-24: "Rate the
 * order and tip the rider - one tap after delivery"). Nothing on an older API that sends neither.
 */
export function OrderRatingTip({ detail }: { detail: OrderDetail }) {
  const cashTip = amount(detail.rider_tip);
  const walletTip = amount(detail.rider_tip_wallet);
  const tip = cashTip + walletTip;
  const rating = detail.rating;
  const delivered = detail.order_status === 'DELIVERED';
  if (tip <= 0 && !rating && !(delivered && rating === null)) return null;
  return (
    <section className="order-panel__section" aria-label="Rating and tip">
      <h3 className="order-panel__label">Rating and tip</h3>
      {rating ? (
        <div data-testid="order-rating">
          <span className="rating-stars" role="img" aria-label={`${rating.stars} of 5 stars`}>
            {starsText(rating.stars)}
          </span>
          {rating.created_at ? <span className="order-panel__meta"> · {whenText(rating.created_at)}</span> : null}
          {(rating.tags ?? []).length ? (
            <span className="tag-chips">
              {(rating.tags ?? []).map((t) => (
                <span key={t} className="tag-chip">
                  {tagLabel(t)}
                </span>
              ))}
            </span>
          ) : null}
          {rating.comment ? <p className="order-panel__note">“{rating.comment}”</p> : null}
        </div>
      ) : delivered && rating === null ? (
        <p className="order-panel__meta">Not rated yet.</p>
      ) : null}
      {tip > 0 ? (
        <p data-testid="order-tip">
          Rider tip <strong>{formatMoney(tip)}</strong>
          <span className="order-panel__meta">
            {' '}
            · {walletTip > 0 && cashTip > 0 ? 'cash and wallet' : walletTip > 0 ? 'from the wallet' : 'collected with cash'} · goes 100% to the
            rider
          </span>
        </p>
      ) : null}
    </section>
  );
}

/** The "Repeat" tag on an order placed from a repeat basket (migration 054). */
export function RepeatTag({ basketId }: { basketId: string | null | undefined }) {
  if (!basketId) return null;
  return (
    <span className="pay-chip repeat-chip" title="Placed by itself from the customer's repeat basket">
      Repeat
    </span>
  );
}
