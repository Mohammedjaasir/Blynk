import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sellerSubmissions, sellers } from '../../api/sellers';

/**
 * The More cards for the seller admin (owner, 2026-10-25): Sellers (badge = shops waiting for
 * approval) and Seller products (badge = products waiting for approval). Seller commission is
 * reached from the Sellers screen. The counts are an extra: a failure just shows no badge.
 */
export function SellerHubCards() {
  const [waitingSellers, setWaitingSellers] = useState(0);
  const [waitingProducts, setWaitingProducts] = useState(0);

  useEffect(() => {
    let live = true;
    sellers
      .list({ status: 'PENDING' })
      .then((rows) => live && setWaitingSellers(rows.length))
      .catch(() => undefined);
    sellerSubmissions
      .pendingCount()
      .then((n) => live && setWaitingProducts(n))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <li>
        {/* Invite-only seller shops: add, approve, commission, payouts (owner, 2026-10-25). */}
        <Link className="cat-hub__card" to="/more/sellers">
          <span className="cat-hub__title">Sellers</span>
          {waitingSellers > 0 ? (
            <span className="cat-hub__count" aria-label={`${waitingSellers} sellers waiting`}>
              {waitingSellers}
            </span>
          ) : null}
        </Link>
      </li>
      <li>
        <Link className="cat-hub__card" to="/more/seller-products">
          <span className="cat-hub__title">Seller products</span>
          {waitingProducts > 0 ? (
            <span className="cat-hub__count" aria-label={`${waitingProducts} products waiting`}>
              {waitingProducts}
            </span>
          ) : null}
        </Link>
      </li>
    </>
  );
}
